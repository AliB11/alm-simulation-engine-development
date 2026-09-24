import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { McOptions } from './monteCarlo';
import {
  DEFAULT_MC,
  histogram,
  makeGaussian,
  mulberry32,
  perturbInput,
  percentile,
  runMonteCarlo,
  shiftedSchedule,
  summarizeMc,
} from './monteCarlo';
import { buildVintages } from './engine';
import { near, presetInput } from './testUtils';

const base = presetInput('nikvam');
const deterministic: McOptions = { ...DEFAULT_MC, intensity: 0 };

describe('monte carlo — random number generation', () => {
  it('produces reproducible sequences from the same seed', () => {
    const a = mulberry32(1403);
    const b = mulberry32(1403);
    for (let i = 0; i < 200; i++) assert.equal(a(), b());

    const c = mulberry32(1404);
    let same = 0;
    const d = mulberry32(1403);
    for (let i = 0; i < 200; i++) if (c() === d()) same++;
    assert.ok(same < 5, 'different seeds must diverge');
  });

  it('stays inside [0,1) and survives degenerate seeds', () => {
    for (const seed of [0, 1, -7, NaN, Infinity, 1e15, 0.4]) {
      const rng = mulberry32(seed);
      for (let i = 0; i < 500; i++) {
        const v = rng();
        assert.ok(Number.isFinite(v) && v >= 0 && v < 1, `seed ${seed} produced ${v}`);
      }
    }
  });

  it('draws gaussians with roughly zero mean and unit variance', () => {
    const g = makeGaussian(mulberry32(7));
    const n = 40000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = g();
      assert.ok(Number.isFinite(v));
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    const variance = sq / n - mean * mean;
    assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
    assert.ok(Math.abs(variance - 1) < 0.08, `variance ${variance}`);
  });
});

describe('monte carlo — perturbation of the input', () => {
  it('is a no-op at zero intensity', () => {
    const { input: p, perturbation } = perturbInput(base, deterministic, makeGaussian(mulberry32(1)));
    assert.deepEqual(p.behavior, base.behavior);
    assert.deepEqual(p.config, base.config);
    assert.deepEqual(p.schedule, base.schedule);
    assert.deepEqual(p.tiers, base.tiers);
    assert.deepEqual(perturbation, {
      takeUpRate: base.behavior.takeUpRate,
      approvalRate: base.behavior.approvalRate,
      runoffRate: base.behavior.runoffRate,
      churnRate: base.behavior.churnRate,
      totalDeposit: base.behavior.totalDeposit,
      defaultRate: base.config.defaultRate,
      timingShift: 0,
    });
  });

  it('keeps every perturbed value inside the ranges the engine accepts', () => {
    const rng = mulberry32(99);
    const g = makeGaussian(rng);
    const opts: McOptions = { ...DEFAULT_MC, intensity: 100 };
    for (let i = 0; i < 400; i++) {
      const { perturbation: p } = perturbInput(base, opts, g);
      for (const key of ['takeUpRate', 'approvalRate', 'runoffRate', 'churnRate', 'defaultRate'] as const) {
        assert.ok(p[key] >= 0 && p[key] <= 100, `${key} = ${p[key]} out of range`);
      }
      assert.ok(Number.isFinite(p.totalDeposit) && p.totalDeposit >= 0);
      assert.ok(Number.isInteger(p.timingShift) && Math.abs(p.timingShift) <= 10);
    }
  });

  it('perturbs only the switches the user turned on', () => {
    const g = makeGaussian(mulberry32(5));
    const opts: McOptions = {
      ...DEFAULT_MC,
      intensity: 80,
      stochastic: { ...DEFAULT_MC.stochastic, takeUpRate: false, totalDeposit: false, timing: false },
    };
    for (let i = 0; i < 50; i++) {
      const { perturbation: p } = perturbInput(base, opts, g);
      assert.equal(p.takeUpRate, base.behavior.takeUpRate);
      assert.equal(p.totalDeposit, base.behavior.totalDeposit);
      assert.equal(p.timingShift, 0);
    }
  });

  it('shifts the deposit schedule without losing any deposit volume', () => {
    for (const shift of [-6, -1, 0, 1, 3, 12, 400]) {
      const schedule = shiftedSchedule(base, shift);
      const horizon = Math.round(base.config.horizon);
      const moved = buildVintages(base.behavior.totalDeposit, schedule, horizon);
      const original = buildVintages(base.behavior.totalDeposit, base.schedule, horizon);
      const totalMoved = moved.reduce((s, v) => s + v.amount, 0);
      const totalOriginal = original.reduce((s, v) => s + v.amount, 0);
      assert.ok(near(totalMoved, totalOriginal, 1e-9), `shift ${shift} lost deposit volume`);
      for (const v of moved) {
        assert.ok(v.month >= 0 && v.month <= horizon, `month ${v.month} outside horizon for shift ${shift}`);
      }
      if (shift === 0) assert.equal(schedule, base.schedule);
    }
  });

  it('keeps a uniform schedule uniform after a timing shock', () => {
    const uniformInput = { ...base, schedule: { mode: 'uniform' as const, uniformMonths: 12, custom: [] } };
    const schedule = shiftedSchedule(uniformInput, 2);
    assert.equal(schedule.mode, 'custom');
    const total = schedule.custom.reduce((s, c) => s + c.share, 0);
    assert.ok(near(total, 100, 1e-9), `shares must stay normalized, got ${total}`);
  });
});

describe('monte carlo — run, summarize and histogram', () => {
  it('summarizes percentiles in non-decreasing order', async () => {
    const summary = await runMonteCarlo(base, { ...DEFAULT_MC, runs: 40, seed: 11, intensity: 60 });
    assert.equal(summary.runs, 40);
    for (const set of [summary.maxHole, summary.endCum, summary.netMargin, summary.leverage, summary.interbankCost]) {
      assert.ok(set.min <= set.p5 + 1e-9);
      assert.ok(set.p5 <= set.p25 + 1e-9);
      assert.ok(set.p25 <= set.p50 + 1e-9);
      assert.ok(set.p50 <= set.p75 + 1e-9);
      assert.ok(set.p75 <= set.p95 + 1e-9);
      assert.ok(set.p95 <= set.p99 + 1e-9);
      assert.ok(set.p99 <= set.max + 1e-9);
      assert.ok(Number.isFinite(set.mean));
    }
    assert.equal(summary.samples.length, 40);
    assert.ok(summary.pTipping >= 0 && summary.pTipping <= 1);
    assert.ok(summary.pDeficit >= summary.pTipping, 'any deficit is at least as likely as tipping');
    assert.ok(summary.worst && summary.best);
    assert.ok(summary.worst!.kpis.maxHole >= summary.best!.kpis.maxHole);
  });

  it('is fully reproducible from the seed and changes when the seed changes', async () => {
    const opts: McOptions = { ...DEFAULT_MC, runs: 25, intensity: 70 };
    const a = await runMonteCarlo(base, { ...opts, seed: 42 });
    const b = await runMonteCarlo(base, { ...opts, seed: 42 });
    const c = await runMonteCarlo(base, { ...opts, seed: 43 });
    assert.equal(a.pTipping, b.pTipping);
    assert.equal(a.maxHole.p50, b.maxHole.p50);
    assert.deepEqual(a.samples, b.samples);
    assert.notDeepEqual(a.samples, c.samples);
  });

  it('collapses to the deterministic simulation at zero intensity', async () => {
    const opts: McOptions = { ...DEFAULT_MC, runs: 12, intensity: 0, seed: 3 };
    const summary = await runMonteCarlo(base, opts);
    const { simulate } = await import('./engine');
    const kpis = simulate(base, false).kpis;
    assert.equal(summary.maxHole.min, kpis.maxHole);
    assert.equal(summary.maxHole.max, kpis.maxHole);
    assert.equal(summary.netMargin.p50, kpis.netMargin);
    assert.equal(summary.endCum.mean, kpis.endCum);
    assert.equal(summary.pTipping, kpis.tippingPoint === null ? 0 : 1);
  });

  it('honours the stop signal and reports progress', async () => {
    const seen: number[] = [];
    let calls = 0;
    const summary = await runMonteCarlo(
      base,
      { ...DEFAULT_MC, runs: 100, intensity: 40 },
      (p) => seen.push(p.done),
      () => ++calls > 30,
    );
    assert.ok(summary.runs < 100, `expected an early stop, got ${summary.runs}`);
    assert.ok(seen.length > 0 && seen[seen.length - 1] === summary.runs);
    assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress must be monotonic');
  });

  it('clamps absurd run counts and never returns NaN statistics', async () => {
    const summary = await runMonteCarlo(base, { ...DEFAULT_MC, runs: 0, intensity: 100, seed: 1 });
    assert.ok(summary.runs >= 1);
    for (const set of [summary.maxHole, summary.netMargin]) {
      for (const v of Object.values(set)) assert.ok(Number.isFinite(v));
    }
    // اهرم می‌تواند بی‌نهایت شود؛ خلاصه باید آن را با عدد متناهی جایگزین کند
    assert.ok(Number.isFinite(summary.leverage.max));
  });

  it('handles an empty sample set in summarizeMc and percentile', () => {
    const empty = summarizeMc([], DEFAULT_MC, 0);
    assert.equal(empty.runs, 0);
    assert.equal(empty.pTipping, 0);
    assert.equal(empty.maxHole.p95, 0);
    assert.equal(empty.worst, null);
    assert.equal(empty.best, null);
    assert.equal(percentile([], 95), 0);
    assert.equal(percentile([5], 99), 5);
    assert.equal(percentile([1, 2, 3, 4], 50), 2);
    assert.equal(percentile([1, 2, 3, 4], 100), 4);
    assert.deepEqual(histogram([], 5), []);
  });

  it('bins the histogram so that counts add up to the sample size', () => {
    const values = Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 100);
    const bins = histogram(values, 10);
    assert.equal(bins.length, 10);
    assert.equal(bins.reduce((s, b) => s + b.count, 0), values.length);
    assert.ok(bins.every((b) => b.to >= b.from));
    for (let i = 1; i < bins.length; i++) assert.ok(bins[i].from >= bins[i - 1].to - 1e-9);

    const flat = histogram([3, 3, 3], 8);
    assert.equal(flat.length, 1);
    assert.equal(flat[0].count, 3);

    const withJunk = histogram([1, NaN, Infinity, 2, -Infinity], 4);
    assert.equal(withJunk.reduce((s, b) => s + b.count, 0), 2, 'non-finite samples are dropped');
  });
});

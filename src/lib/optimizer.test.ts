import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Tier } from '../types';
import type { DesignLevers } from './optimizer';
import {
  applyLevers,
  DEFAULT_CONSTRAINTS,
  describeLevers,
  designToInput,
  leverDistance,
  leverKey,
  MULTI_STARTS,
  NEUTRAL_LEVERS,
  objectiveValue,
  optimizeDesign,
  violations,
} from './optimizer';
import { simulate } from './engine';
import { near, presetInput } from './testUtils';

const input = presetInput('sample-2');
const sumAlloc = (tiers: Tier[]) => tiers.reduce((s, t) => s + t.allocation, 0);

describe('design optimizer — lever mechanics', () => {
  it('leaves tiers untouched at the neutral design', () => {
    assert.deepEqual(applyLevers(input.tiers, NEUTRAL_LEVERS), input.tiers);
    assert.deepEqual(describeLevers(NEUTRAL_LEVERS), ['بدون تغییر (طرح جاری)']);
    assert.equal(leverDistance(NEUTRAL_LEVERS), 0);
  });

  it('scales every alpha by the same factor without touching timing', () => {
    const scaled = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, alphaScale: 200 });
    assert.equal(scaled.length, input.tiers.length);
    scaled.forEach((t, i) => {
      // سقف ۵۰۰ همان سقف سازندهٔ پله است؛ مقیاس ۲۰۰٪ روی α=۳۲۰ به ۵۰۰ مهار می‌شود
      assert.ok(near(t.alpha, Math.min(500, input.tiers[i].alpha * 2)));
      assert.ok(t.alpha <= 500);
      assert.equal(t.tDep, input.tiers[i].tDep);
      assert.equal(t.tLoan, input.tiers[i].tLoan);
      assert.equal(t.allocation, input.tiers[i].allocation);
      assert.equal(t.id, input.tiers[i].id);
    });
  });

  it('never emits an alpha the tier builder cannot edit or JSON cannot re-import', () => {
    const huge = input.tiers.map((t) => ({ ...t, alpha: 400 }));
    const scaled = applyLevers(huge, { ...NEUTRAL_LEVERS, alphaScale: 200 });
    assert.ok(scaled.every((t) => t.alpha === 500));
    const tilted = applyLevers(huge, { ...NEUTRAL_LEVERS, alphaScale: 200, tilt: 'longWait' });
    assert.ok(tilted.every((t) => t.alpha <= 500 && t.alpha >= 0));
  });

  it('shifts waiting and repayment periods but clamps them into legal ranges', () => {
    const shifted = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tDepShift: -5, tLoanShift: -100 });
    shifted.forEach((t, i) => {
      assert.equal(t.tDep, Math.max(1, input.tiers[i].tDep - 5));
      assert.equal(t.tLoan, 6, 'repayment must clamp at the 6-month floor');
      assert.equal(t.alpha, input.tiers[i].alpha);
    });

    const up = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tDepShift: 40, tLoanShift: 400 });
    up.forEach((t) => {
      assert.equal(t.tDep, 12);
      assert.equal(t.tLoan, 60);
    });
  });

  it('reweights allocations by tilt while preserving the allocation total', () => {
    const before = sumAlloc(input.tiers);
    for (const tilt of ['longWait', 'shortWait'] as const) {
      const tilted = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tilt });
      assert.ok(near(sumAlloc(tilted), before, 1e-9), `${tilt} must preserve the allocation total`);
      assert.notDeepEqual(
        tilted.map((t) => t.allocation),
        input.tiers.map((t) => t.allocation),
      );
    }

    const longWait = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tilt: 'longWait' });
    const shortWait = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tilt: 'shortWait' });
    // پلهٔ با بلندترین دورهٔ انتظار باید در longWait سهم بیشتری بگیرد
    const longest = input.tiers.reduce((best, t, i) => (t.tDep > input.tiers[best].tDep ? i : best), 0);
    assert.ok(longWait[longest].allocation > shortWait[longest].allocation);
  });

  it('is robust against degenerate tier data', () => {
    const broken: Tier[] = [
      { id: 'a', name: 'a', tDep: NaN, tLoan: NaN, alpha: NaN, minBalance: NaN, allocation: NaN, rateOverride: null },
      { id: 'b', name: 'b', tDep: 3, tLoan: 12, alpha: 50, minBalance: 0, allocation: 0, rateOverride: null },
    ];
    const levers: DesignLevers = { alphaScale: 150, tDepShift: 2, tLoanShift: -6, tilt: 'longWait' };
    const out = applyLevers(broken, levers);
    assert.equal(out.length, 2);
    for (const t of out) {
      assert.ok(Number.isFinite(t.tDep) && t.tDep >= 1 && t.tDep <= 12);
      assert.ok(Number.isFinite(t.tLoan) && t.tLoan >= 6 && t.tLoan <= 60);
      assert.ok(Number.isFinite(t.alpha) && t.alpha >= 0);
      assert.ok(Number.isFinite(t.allocation) && t.allocation >= 0);
    }
    assert.equal(sumAlloc(out), 0, 'an all-zero allocation vector stays zero');
    assert.deepEqual(applyLevers([], levers), []);
  });

  it('applies levers to the input tiers only once (never cumulatively inside a search)', () => {
    const once = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, alphaScale: 150 });
    const twice = applyLevers(once, { ...NEUTRAL_LEVERS, alphaScale: 150 });
    assert.ok(!near(once[0].alpha, twice[0].alpha), 'applying twice must compound, proving applyLevers is stateless');
    const next = designToInput(input, { ...NEUTRAL_LEVERS, alphaScale: 150 });
    assert.deepEqual(next.tiers, once);
    assert.equal(next.config, input.config);
    assert.equal(next.behavior, input.behavior);
    assert.equal(next.schedule, input.schedule);
  });
});

describe('design optimizer — objective, constraints and search', () => {
  it('reports constraint violations against the KPIs they refer to', () => {
    const kpis = simulate(input, false).kpis;
    assert.deepEqual(violations(kpis, { ...DEFAULT_CONSTRAINTS, maxHolePct: 0, requirePositiveMargin: false }), []);

    const loose = violations(kpis, { maxHolePct: 0, requireSolvent: true, maxLeverage: 0, requirePositiveMargin: true });
    assert.ok(loose.includes('حاشیهٔ خالص منفی'), 'sampleTwo is loss-making at defaults');
    if (kpis.tippingPoint !== null) {
      assert.ok(loose.some((v) => v.includes('واژگونی')));
    }

    const tight = violations(kpis, { maxHolePct: 0.001, requireSolvent: false, maxLeverage: 0.01, requirePositiveMargin: false });
    assert.equal(tight.length, 2, 'hole cap and leverage cap are both breached');
  });

  it('maps each objective to its own KPI', () => {
    const kpis = simulate(input, false).kpis;
    assert.equal(objectiveValue(kpis, 'margin'), kpis.netMargin);
    assert.equal(objectiveValue(kpis, 'income'), kpis.totalIncomeInHorizon);
    assert.equal(objectiveValue(kpis, 'volume'), kpis.totalCommitment);
    assert.equal(objectiveValue(kpis, 'safety'), -kpis.maxHole);
  });

  it('finds a design no worse than the baseline for every objective', () => {
    for (const objective of ['margin', 'income', 'volume', 'safety'] as const) {
      const res = optimizeDesign(input, { objective, constraints: { ...DEFAULT_CONSTRAINTS, requirePositiveMargin: false } });
      assert.ok(res.evaluations > 1, 'the search must evaluate more than the baseline');
      assert.ok(res.passes >= 1 && res.passes <= 3);
      assert.ok(
        res.best.objective >= res.baseline.objective - 1e-9,
        `${objective}: best ${res.best.objective} must not be worse than baseline ${res.baseline.objective}`,
      );
      if (res.anyFeasible) assert.ok(res.best.feasible, 'a feasible design must always outrank an infeasible one');
      for (const c of res.candidates) {
        assert.ok(Number.isFinite(c.objective));
        assert.ok(c.kpis && Number.isFinite(c.kpis.maxHole));
      }
      // نامزدها باید به ترتیب اولویت مرتب باشند
      for (let i = 1; i < res.candidates.length; i++) {
        const prev = res.candidates[i - 1];
        const cur = res.candidates[i];
        assert.ok(prev.feasible || !cur.feasible, 'feasible designs come first');
        if (prev.feasible === cur.feasible) assert.ok(prev.objective >= cur.objective - 1e-9);
      }
    }
  });

  it('never exceeds the liquidity-hole cap when a feasible design exists', () => {
    const constraints = { ...DEFAULT_CONSTRAINTS, maxHolePct: 25, requirePositiveMargin: false };
    const res = optimizeDesign(input, { objective: 'volume', constraints });
    if (res.anyFeasible) {
      const feasible = res.candidates.filter((c) => c.feasible);
      assert.ok(feasible.length > 0);
      for (const c of feasible) {
        assert.ok((c.kpis.maxHole / c.kpis.netDeposit) * 100 <= 25 + 1e-9);
        assert.deepEqual(c.violations, []);
      }
      assert.ok(res.best.feasible);
    }
  });

  it('produces identical results for identical inputs (deterministic search)', () => {
    const a = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS });
    const b = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS });
    assert.equal(a.best.key, b.best.key);
    assert.equal(a.evaluations, b.evaluations);
    assert.deepEqual(a.best.kpis, b.best.kpis);
    assert.deepEqual(
      a.candidates.map((c) => c.key),
      b.candidates.map((c) => c.key),
    );
  });

  it('stops early when a pass improves nothing and keeps the pool deduplicated', () => {
    const res = optimizeDesign(input, { objective: 'safety', constraints: DEFAULT_CONSTRAINTS, passes: 3, topN: 4 });
    const keys = new Set(res.candidates.map((c) => c.key));
    assert.equal(keys.size, res.candidates.length, 'topN must not contain duplicates');
    assert.ok(res.candidates.length <= 4);
    assert.equal(res.best.key, leverKey(res.best.levers));
    assert.equal(res.starts, MULTI_STARTS.length);
    // هر نقطهٔ شروع حداکثر ۱ + گذر × ابعاد شبکه ارزیابی تازه دارد؛ اشتراک‌گذاری استخر فقط کمش می‌کند
    assert.ok(
      res.evaluations <= MULTI_STARTS.length * (1 + 3 * (9 + 9 + 8 + 3)),
      'multi-start coordinate descent is bounded by starts × grid size',
    );
  });

  it('searches from every start and never finishes worse than the single-start search', () => {
    const multi = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS });
    const single = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS, multiStart: false });
    assert.equal(single.starts, 1);
    assert.equal(multi.starts, MULTI_STARTS.length);
    assert.ok(multi.evaluations >= single.evaluations);
    assert.ok(
      single.evaluations <= 1 + 2 * (9 + 9 + 8 + 3),
      'the legacy single-start path keeps its original evaluation bound',
    );
    // نقطهٔ شروع اول همان طرح جاری است، پس چندشروعی حداقل به خوبی تک‌شروعی است
    const multiWins =
      multi.best.feasible !== single.best.feasible
        ? multi.best.feasible
        : multi.best.objective >= single.best.objective - 1e-9;
    assert.ok(multiWins, 'multi-start must dominate single-start');
  });

  it('describes levers in Persian with the right signs', () => {
    const parts = describeLevers({ alphaScale: 125, tDepShift: -2, tLoanShift: 12, tilt: 'longWait' });
    assert.ok(parts.some((p) => p.includes('ضرایب برابری') && p.includes('۱٫۲۵')));
    assert.ok(parts.some((p) => p.includes('دورهٔ انتظار') && p.includes('−') && p.includes('۲')));
    assert.ok(parts.some((p) => p.includes('بازپرداخت') && p.includes('+') && p.includes('۱۲')));
    assert.ok(parts.some((p) => p.includes('انتظار بلند')));
  });
});

describe('optimizer — violation tolerances', () => {
  it('tolerates floating-point dust in the non-negative-margin constraint', () => {
    const kpis = simulate(input, false).kpis;
    const dusty = { ...kpis, netMargin: -1e-9 };
    assert.deepEqual(violations(dusty, { maxHolePct: 0, requireSolvent: false, maxLeverage: 0, requirePositiveMargin: true }), []);
    const losing = { ...kpis, netMargin: -1 };
    assert.ok(
      violations(losing, { maxHolePct: 0, requireSolvent: false, maxLeverage: 0, requirePositiveMargin: true }).includes('حاشیهٔ خالص منفی'),
    );
  });
});

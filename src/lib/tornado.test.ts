import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SensMetric } from './engine';
import { SENS_VARS, applySensitivity, simulate } from './engine';
import {
  higherIsBetter,
  isNegligible,
  LEVERAGE_DISPLAY_CAP,
  NEGLIGIBLE_SWING_SHARE,
  runTornado,
  tornadoMetric,
  type TornadoBar,
} from './tornado';
import { presetInput } from './testUtils';

const METRICS: SensMetric[] = ['maxHole', 'tipping', 'endCum', 'leverage', 'margin'];

describe('tornado — one-at-a-time risk drivers', () => {
  const input = presetInput('sample-1');

  it('runs exactly two simulations per risk variable plus the base case', () => {
    const t = runTornado(input, 'maxHole');
    assert.equal(t.bars.length, SENS_VARS.length);
    assert.equal(t.evaluations, SENS_VARS.length * 2 + 1);
  });

  it('reproduces the stress-grid endpoints, so the tornado agrees with the 2-D matrix', () => {
    const t = runTornado(input, 'maxHole');
    for (const bar of t.bars) {
      const def = SENS_VARS.find((v) => v.key === bar.key)!;
      const grid = def.values(input);
      assert.equal(bar.low, Math.min(...grid));
      assert.equal(bar.high, Math.max(...grid));
      // همان ورودی‌ها، همان خروجی‌ها — هیچ مسیر محاسبهٔ جداگانه‌ای وجود ندارد
      const lowKpis = simulate(applySensitivity(input, bar.key, bar.low), false).kpis;
      const highKpis = simulate(applySensitivity(input, bar.key, bar.high), false).kpis;
      assert.equal(bar.lowValue, tornadoMetric(lowKpis, 'maxHole', input.config.horizon));
      assert.equal(bar.highValue, tornadoMetric(highKpis, 'maxHole', input.config.horizon));
    }
  });

  it('ranks drivers by swing, largest first', () => {
    for (const metric of METRICS) {
      const t = runTornado(input, metric);
      for (let i = 1; i < t.bars.length; i++) {
        assert.ok(t.bars[i - 1].swing >= t.bars[i].swing, `${metric}: bars must be sorted by swing`);
      }
      for (const bar of t.bars) {
        assert.ok(bar.swing >= 0);
        assert.ok(
          Math.abs(bar.swing - (Math.max(bar.lowValue, bar.highValue, bar.base) - Math.min(bar.lowValue, bar.highValue, bar.base))) < 1e-9,
        );
        assert.ok(Math.abs(bar.lowDelta - (bar.lowValue - bar.base)) < 1e-9);
        assert.ok(Math.abs(bar.highDelta - (bar.highValue - bar.base)) < 1e-9);
      }
      assert.equal(t.base, tornadoMetric(simulate(input, false).kpis, metric, input.config.horizon));
    }
  });

  it('treats "no tipping point" as the safest possible outcome', () => {
    const H = input.config.horizon;
    const safe = simulate({ ...input, behavior: { ...input.behavior, takeUpRate: 0, churnRate: 0 } }, false).kpis;
    assert.equal(safe.tippingPoint, null);
    assert.equal(tornadoMetric(safe, 'tipping', H), H + 1);
    const risky = simulate(input, false).kpis;
    assert.ok(risky.tippingPoint !== null);
    assert.equal(tornadoMetric(risky, 'tipping', H), risky.tippingPoint);
    assert.ok(tornadoMetric(safe, 'tipping', H) > tornadoMetric(risky, 'tipping', H));
  });

  it('caps an infinite leverage so one cell cannot swallow the whole chart', () => {
    const squeezed = simulate({ ...input, config: { ...input.config, reserveRatio: 100 } }, false).kpis;
    assert.equal(squeezed.leverage, Infinity);
    assert.equal(tornadoMetric(squeezed, 'leverage', input.config.horizon), LEVERAGE_DISPLAY_CAP);
    const t = runTornado({ ...input, config: { ...input.config, reserveRatio: 99 } }, 'leverage');
    for (const bar of t.bars) {
      assert.ok(Number.isFinite(bar.lowValue) && Number.isFinite(bar.highValue));
      assert.ok(bar.lowValue <= LEVERAGE_DISPLAY_CAP && bar.highValue <= LEVERAGE_DISPLAY_CAP);
    }
  });

  it('stays finite for broken inputs instead of poisoning the chart', () => {
    const broken = {
      ...input,
      tiers: input.tiers.map((t) => ({ ...t, alpha: NaN })),
      behavior: { ...input.behavior, totalDeposit: NaN },
    };
    const t = runTornado(broken, 'margin');
    assert.ok(Number.isFinite(t.base));
    for (const bar of t.bars) {
      for (const v of [bar.lowValue, bar.highValue, bar.swing, bar.lowDelta, bar.highDelta]) {
        assert.ok(Number.isFinite(v), `non-finite tornado value for ${bar.key}`);
      }
    }
  });

  it('flags the direction of every metric for colour coding', () => {
    assert.equal(higherIsBetter('endCum'), true);
    assert.equal(higherIsBetter('margin'), true);
    assert.equal(higherIsBetter('tipping'), true);
    assert.equal(higherIsBetter('maxHole'), false);
    assert.equal(higherIsBetter('leverage'), false);
  });

  it('only dims drivers that are negligible relative to the whole chart', () => {
    const bar = (swing: number): TornadoBar => ({
      key: 'defaultRate',
      label: 'x',
      symbol: 'δ',
      current: 0,
      low: 0,
      high: 1,
      base: 0,
      lowValue: 0,
      highValue: 0,
      lowDelta: 0,
      highDelta: 0,
      swing,
    });
    // سهم کمتر از نیم‌درصد از کل نوسان ⇒ کم‌اثر
    assert.equal(isNegligible(bar(0.4), 1e10, 100), true);
    assert.equal(isNegligible(bar(0.5), 1e10, 100), false);
    assert.equal(isNegligible(bar(0), 1e10, 100), true);
    // بدون کل نوسان، ملاک نسبتی محافظه‌کارانه است — نه مقایسه با خودِ پایه
    assert.equal(isNegligible(bar(1e5), 1e10), true);
    assert.equal(isNegligible(bar(1e9), 1e10), false);
    assert.ok(NEGLIGIBLE_SWING_SHARE > 0 && NEGLIGIBLE_SWING_SHARE < 0.05);

    // رگرسیون: در طرح نمونهٔ اول، «نرخ قبولی اعتباری» با سهم ۸٫۷٪ از نوسان
    // حداکثر کسری، نباید کم‌اثر شمرده شود (پیش‌تر آستانهٔ نادرست آن را
    // کم‌رنگ می‌کرد).
    const t = runTornado(input, 'maxHole');
    const total = t.bars.reduce((s, b) => s + b.swing, 0);
    const approval = t.bars.find((b) => b.key === 'approvalRate')!;
    assert.ok(approval.swing / total > 0.05, 'approval rate must be a material driver here');
    assert.equal(isNegligible(approval, t.base, total), false);
    const trivial = t.bars.filter((b) => isNegligible(b, t.base, total));
    for (const b of trivial) assert.ok(b.swing / total < NEGLIGIBLE_SWING_SHARE);
  });

  it('does not mutate the input it was given', () => {
    const before = JSON.stringify(input);
    runTornado(input, 'maxHole');
    assert.equal(JSON.stringify(input), before);
  });
});

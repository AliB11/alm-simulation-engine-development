import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Tier } from '../types';
import type { CandidateDesign, DesignLevers } from './optimizer';
import {
  applyLevers,
  DEFAULT_CONSTRAINTS,
  describeLevers,
  designFingerprint,
  designTiers,
  designToInput,
  leverDistance,
  leverKey,
  LEVER_GRID,
  MULTI_STARTS,
  NEUTRAL_LEVERS,
  objectiveValue,
  optimizeDesign,
  violationSeverity,
  violations,
} from './optimizer';
import { simulate } from './engine';
import { PRESETS } from './presets';
import { near, presetInput } from './testUtils';
import { TIER_ALPHA_MAX, TIER_ALPHA_MIN, TIER_WAIT_MAX } from './limits';

const input = presetInput('sample-1');

/** قرارداد رتبه‌بندی بهینه‌یاب، به شکل قابل آزمون */
function notWorseThan(best: CandidateDesign, base: CandidateDesign): boolean {
  if (best.feasible !== base.feasible) return best.feasible;
  if (!best.feasible && best.severity > base.severity + 1e-12) return false;
  if (best.feasible === base.feasible && best.objective < base.objective - 1e-9 * Math.max(1, Math.abs(base.objective))) {
    return false;
  }
  return true;
}

describe('design optimizer — lever mechanics', () => {
  it('leaves tiers untouched at the neutral design', () => {
    assert.deepEqual(applyLevers(input.tiers, NEUTRAL_LEVERS), input.tiers);
    assert.deepEqual(describeLevers(NEUTRAL_LEVERS), ['بدون تغییر (طرح جاری)']);
    assert.equal(leverDistance(NEUTRAL_LEVERS), 0);
  });

  it('scales every alpha by the same factor without touching timing or pricing', () => {
    const scaled = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, alphaScale: 200 });
    assert.equal(scaled.length, input.tiers.length);
    scaled.forEach((t, i) => {
      // بهینه‌یاب باید همان سقف مشترک سازندهٔ پله/ورود فایل را رعایت کند.
      assert.ok(near(t.alpha, Math.min(TIER_ALPHA_MAX, input.tiers[i].alpha * 2)));
      assert.ok(t.alpha <= TIER_ALPHA_MAX);
      assert.equal(t.tDep, input.tiers[i].tDep);
      assert.equal(t.tLoan, input.tiers[i].tLoan);
      assert.equal(t.allocation, input.tiers[i].allocation);
      assert.equal(t.rateOverride, input.tiers[i].rateOverride);
      assert.equal(t.id, input.tiers[i].id);
    });
  });

  it('never emits an alpha the tier builder cannot edit or JSON cannot re-import', () => {
    const huge = input.tiers.map((t) => ({ ...t, alpha: 400 }));
    const scaled = applyLevers(huge, { ...NEUTRAL_LEVERS, alphaScale: 200 });
    assert.ok(scaled.every((t) => t.alpha === TIER_ALPHA_MAX));
  });

  it('shifts waiting and repayment periods but clamps them into legal ranges', () => {
    const shifted = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tDepShift: -5, tLoanShift: -100 });
    shifted.forEach((t, i) => {
      assert.equal(t.tDep, Math.max(1, input.tiers[i].tDep - 5));
      assert.equal(t.tLoan, 12, 'repayment must snap to the shortest valid product term');
      assert.equal(t.alpha, input.tiers[i].alpha);
    });

    const up = applyLevers(input.tiers, { ...NEUTRAL_LEVERS, tDepShift: 40, tLoanShift: 400 });
    up.forEach((t) => {
      assert.equal(t.tDep, TIER_WAIT_MAX);
      assert.equal(t.tLoan, 60);
    });
  });

  it('changes only waiting, repayment and alpha while preserving pricing and allocation exactly', () => {
    const changed = designTiers(input, { alphaScale: 75, tDepShift: 3, tLoanShift: -24 });
    changed.forEach((tier, index) => {
      assert.equal(tier.rateOverride, input.tiers[index].rateOverride);
      assert.equal(tier.allocation, input.tiers[index].allocation);
      assert.equal(tier.minBalance, input.tiers[index].minBalance);
      assert.equal(tier.id, input.tiers[index].id);
      assert.ok([12, 24, 36, 48, 60].includes(tier.tLoan));
      assert.ok(tier.alpha >= TIER_ALPHA_MIN && tier.alpha <= TIER_ALPHA_MAX);
    });
  });

  it('is robust against degenerate tier data', () => {
    const broken: Tier[] = [
      {
        id: 'a',
        name: 'a',
        tDep: NaN,
        tLoan: NaN,
        alpha: NaN,
        minBalance: NaN,
        allocation: NaN,
        rateOverride: Number.NaN,
      },
      { id: 'b', name: 'b', tDep: 3, tLoan: 12, alpha: 50, minBalance: 0, allocation: 0, rateOverride: null },
    ];
    const levers: DesignLevers = { alphaScale: 125, tDepShift: 2, tLoanShift: -12 };
    const out = applyLevers(broken, levers);
    assert.equal(out.length, 2);
    for (const t of out) {
      assert.ok(Number.isFinite(t.tDep) && t.tDep >= 1 && t.tDep <= TIER_WAIT_MAX);
      assert.ok(Number.isFinite(t.tLoan) && t.tLoan >= 6 && t.tLoan <= 60);
      assert.ok(Number.isFinite(t.alpha) && t.alpha >= TIER_ALPHA_MIN && t.alpha <= TIER_ALPHA_MAX);
    }
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

  it('measures how badly a design misses each constraint, not just whether it misses it', () => {
    const kpis = simulate(input, false).kpis;
    const net = kpis.netDeposit;
    assert.equal(violationSeverity(kpis, { maxHolePct: 0, requireSolvent: false, maxLeverage: 0, requirePositiveMargin: false }), 0);

    // دو طرح ناموجه با «تعداد» نقض یکسان باید شدت متفاوتی داشته باشند
    const small = { ...kpis, maxHole: net * 0.11, netMargin: -1 };
    const huge = { ...kpis, maxHole: net * 0.9, netMargin: -1 };
    const c = { maxHolePct: 10, requireSolvent: false, maxLeverage: 0, requirePositiveMargin: false };
    assert.ok(violationSeverity(huge, c) > violationSeverity(small, c));
    assert.ok(violationSeverity(small, c) > 0);

    // اهرم بی‌نهایت نباید شدت را NaN کند
    assert.equal(
      Number.isFinite(violationSeverity({ ...kpis, leverage: Infinity }, { maxHolePct: 0, requireSolvent: false, maxLeverage: 1, requirePositiveMargin: false })),
      true,
    );
  });

  it('maps each objective to its own KPI', () => {
    const kpis = simulate(input, false).kpis;
    assert.equal(objectiveValue(kpis, 'margin'), kpis.netMargin);
    assert.equal(objectiveValue(kpis, 'income'), kpis.totalIncomeInHorizon);
    assert.equal(objectiveValue(kpis, 'volume'), kpis.totalCommitment);
    assert.equal(objectiveValue(kpis, 'safety'), -kpis.maxHole);
  });

  it('ships default constraints that every sample plan can actually satisfy', () => {
    // رگرسیون: سقف پیش‌فرضِ ۱۰٪ با فرض‌های رفتاری پیش‌فرض دست‌یافتنی نبود و
    // در نتیجه «هیچ طرح موجهی» پیدا نمی‌شد و کل منطق قیدها مرده بود.
    for (const key of PRESETS.map((preset) => preset.key)) {
      const res = optimizeDesign(presetInput(key), { objective: 'margin', constraints: DEFAULT_CONSTRAINTS, passes: 3 });
      assert.ok(res.anyFeasible, `${key}: the shipped defaults must admit at least one feasible design`);
      assert.ok(res.best.feasible, `${key}: a feasible design must always be the recommendation`);
      assert.deepEqual(res.best.violations, []);
    }
  });

  it('finds a design that is never worse than the baseline for every objective', () => {
    for (const objective of ['margin', 'income', 'volume', 'safety'] as const) {
      const res = optimizeDesign(input, { objective, constraints: { ...DEFAULT_CONSTRAINTS, requirePositiveMargin: false } });
      assert.ok(res.evaluations > 1, 'the search must evaluate more than the baseline');
      assert.ok(res.passes >= 1 && res.passes <= 3);
      assert.ok(
        notWorseThan(res.best, res.baseline),
        `${objective}: best must not rank below the baseline (obj ${res.best.objective} vs ${res.baseline.objective}, severity ${res.best.severity} vs ${res.baseline.severity})`,
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
        assert.ok(notWorseThan(prev, cur), `candidate ${i} must not outrank candidate ${i - 1}`);
      }
    }
  });

  it('prefers the least-violating design, not the biggest objective, when nothing is feasible', () => {
    // رگرسیون: پیش‌تر وقتی هیچ طرحی موجه نبود، رتبه‌بندی به بیشینه‌سازی صرفِ
    // عدد هدف فرو می‌کاست و طراحی را «بهینه» می‌نامید که حفرهٔ نقدینگی‌اش
    // چند برابر طرح جاری بود.
    const impossible = { ...DEFAULT_CONSTRAINTS, maxHolePct: 0.001, requirePositiveMargin: true };
    for (const objective of ['margin', 'income', 'volume'] as const) {
      const res = optimizeDesign(input, { objective, constraints: impossible, passes: 2 });
      assert.equal(res.anyFeasible, false);
      assert.ok(res.best.severity <= res.baseline.severity + 1e-12, `${objective}: best must not violate more than the baseline`);
      for (const c of res.candidates) {
        assert.ok(res.candidates[0].severity <= c.severity + 1e-12, 'the ranked list must be ordered by rising severity');
      }
      const holePct = (res.best.kpis.maxHole / res.best.kpis.netDeposit) * 100;
      assert.ok(holePct < 100, `${objective}: the recommendation must not be a runaway-liquidity design (hole ${holePct}%)`);
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

  it('reports infeasibility honestly when every step lends below the deposit rate', () => {
    // نرخ‌ها قفل‌اند؛ بهینه‌یاب نباید برای سودآور نشان‌دادن طرح، نرخ اختصاصی را تغییر دهد.
    const base = presetInput('sample-3');
    const hopeless = { ...base, config: { ...base.config, depositProfitRate: 40 } };
    assert.ok(hopeless.tiers.every((t) => (t.rateOverride as number) < 40), 'every step must be underwater');

    const res = optimizeDesign(hopeless, { objective: 'margin', constraints: { ...DEFAULT_CONSTRAINTS, requirePositiveMargin: true }, passes: 3 });
    assert.equal(res.anyFeasible, false, 'no design can satisfy requirePositiveMargin here');
    assert.equal(res.best.feasible, false);
    assert.ok(res.best.kpis.netMargin < 0, 'the least-violating design is still loss-making');
    const designed = designTiers(hopeless, res.best.levers);
    assert.deepEqual(designed.map((t) => t.rateOverride), hopeless.tiers.map((t) => t.rateOverride));
    assert.deepEqual(designed.map((t) => t.allocation), hopeless.tiers.map((t) => t.allocation));
  });

  it('collapses lever combinations that land on the same tiers into one candidate', () => {
    // رگرسیون: tDep در ۱۸ و tLoan در ۶۰ مهار می‌شوند، پس چندین جابه‌جایی
    // مثبت به پله‌های یکسان می‌رسیدند و فهرست نامزدها را با ردیف تکراری پر می‌کردند.
    const saturated = input.tiers.map((t) => ({ ...t, tDep: TIER_WAIT_MAX, tLoan: 60 }));
    assert.equal(
      designFingerprint(applyLevers(saturated, { ...NEUTRAL_LEVERS, tDepShift: 1 })),
      designFingerprint(applyLevers(saturated, { ...NEUTRAL_LEVERS, tDepShift: 4 })),
    );
    assert.notEqual(
      designFingerprint(applyLevers(saturated, { ...NEUTRAL_LEVERS, tDepShift: -1 })),
      designFingerprint(applyLevers(saturated, { ...NEUTRAL_LEVERS, tDepShift: 4 })),
    );

    const res = optimizeDesign({ ...input, tiers: saturated }, { objective: 'safety', constraints: DEFAULT_CONSTRAINTS });
    const fps = res.candidates.map((c) => c.fingerprint);
    assert.equal(new Set(fps).size, fps.length, 'the candidate list must not repeat a design');
    assert.ok(res.evaluations <= res.probes, 'deduplication can only shrink the evaluated set');
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
    const grid = LEVER_GRID.alphaScale.length + LEVER_GRID.tDepShift.length + LEVER_GRID.tLoanShift.length;
    assert.ok(
      res.probes <= MULTI_STARTS.length * (1 + 3 * grid),
      'multi-start coordinate descent is bounded by starts × grid size',
    );
  });

  it('searches from every start and never finishes worse than the single-start search', () => {
    const multi = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS });
    const single = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS, multiStart: false });
    assert.equal(single.starts, 1);
    assert.equal(multi.starts, MULTI_STARTS.length);
    assert.ok(multi.probes >= single.probes);
    const grid = LEVER_GRID.alphaScale.length + LEVER_GRID.tDepShift.length + LEVER_GRID.tLoanShift.length;
    assert.ok(single.probes <= 1 + 2 * grid, 'the legacy single-start path keeps its original evaluation bound');
    // نقطهٔ شروع اول همان طرح جاری است، پس چندشروعی حداقل به خوبی تک‌شروعی است
    assert.ok(notWorseThan(multi.best, single.best), 'multi-start must dominate single-start');
  });

  it('describes levers in Persian with the right signs', () => {
    const parts = describeLevers({ alphaScale: 125, tDepShift: -2, tLoanShift: 12 });
    assert.ok(parts.some((p) => p.includes('ضرایب برابری') && p.includes('۱٫۲۵')));
    assert.ok(parts.some((p) => p.includes('دورهٔ انتظار') && p.includes('−') && p.includes('۲')));
    assert.ok(parts.some((p) => p.includes('بازپرداخت') && p.includes('+') && p.includes('۱۲')));
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

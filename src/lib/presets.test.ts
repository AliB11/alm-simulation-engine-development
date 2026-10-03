import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CONFIG,
  DEFAULT_PRESET,
  FARAPOUYA,
  FARAPOUYA_ALPHA_STEPS,
  FARAPOUYA_RATE_STEPS,
  farapouyaAlpha,
  farapouyaFeasible,
  farapouyaMode,
  farapouyaModes,
  farapouyaPoints,
  farapouyaRate,
  farapouyaTermCeiling,
  farapouyaTermPoints,
  labelTiers,
  presetTiers,
  PRESETS,
  sampleOneAlpha,
  tierLabel,
} from './presets';
import { simulate } from './engine';
import { presetInput } from './testUtils';
import { IMPORT_RATE_MAX, TIER_ALPHA_MAX, TIER_WAIT_MAX, TIER_WAIT_MIN } from './limits';
import { DEFAULT_CONSTRAINTS } from './optimizer';
import type { Tier } from '../types';

const makeTier = (id: string, name: string): Tier => ({
  id,
  name,
  tDep: 4,
  tLoan: 12,
  alpha: 100,
  minBalance: 0,
  allocation: 100,
  rateOverride: null,
});

const sampleOne = PRESETS.find((preset) => preset.key === 'sample-1');
/* کلید داخلیِ الگوی دوم همچنان `sample-3` است (تا سناریوهای ذخیره‌شده نشکنند)،
   اما برچسب فارسی آن «نمونه طرح دوم» و محتوایش حالت‌های نگین فراپویا است. */
const sampleTwo = PRESETS.find((preset) => preset.key === 'sample-3');
assert.ok(sampleOne);
assert.ok(sampleTwo);

describe('sample plan one — Negin Omid Zarin, Bank Sepah', () => {
  it('is the default profile and ships beside the relabelled second sample', () => {
    assert.equal(DEFAULT_PRESET, 'sample-1');
    assert.deepEqual(
      PRESETS.map((preset) => preset.key),
      ['sample-1', 'sample-3'],
    );
    assert.deepEqual(
      PRESETS.map((preset) => preset.name),
      ['نمونه طرح اول', 'نمونه طرح دوم'],
    );
    assert.equal(PRESETS.some((preset) => preset.name.includes('طرح سوم')), false, 'the third-plan label is gone');
  });

  it('matches the published loan type, fee choices, ceiling and tenor options without changing the product label', () => {
    assert.equal(sampleOne.name, 'نمونه طرح اول');
    assert.equal(sampleOne.contractType, 'qard');
    assert.equal(sampleOne.rate, 2, 'the default should use the middle published fee option');
    assert.deepEqual(sampleOne.rateOptions, [0, 2, 4]);
    assert.equal(sampleOne.programCap, 1_000_000_000, 'published reports quote a 1-billion-toman product ceiling');
    assert.equal(sampleOne.loanCap, 300_000_000, 'the individual simulation cap uses the conservative recent report');
    assert.deepEqual(sampleOne.waitingRange, [1, 18]);
    assert.deepEqual(sampleOne.repaymentTerms, [12, 24, 36, 48, 60]);
    assert.deepEqual(sampleOne.rateAlphaRanges, {
      0: [2.5, 225],
      2: [3.33, 300],
      4: [4, 360],
    });
    assert.deepEqual(sampleOne.alphaRange, [3.33, 300], 'the default 2% fee range is shown on the preset');
    assert.equal(sampleOne.depositProfitRate, 0);
    assert.equal(DEFAULT_CONFIG.qardFeeRate, 2);
    assert.equal(DEFAULT_CONFIG.loanCap, 300_000_000);
  });

  it('builds all 90 wait/repayment combinations and preserves the published fee-dependent ratio bands', () => {
    assert.ok(sampleOne.repaymentTerms);
    const terms = [...sampleOne.repaymentTerms];
    assert.equal(sampleOne.tiers.length, 18 * terms.length);
    assert.ok(sampleOne.tiers.every((tier) => tier.tDep >= 1 && tier.tDep <= 18));
    assert.ok(sampleOne.tiers.every((tier) => terms.includes(tier.tLoan)));
    assert.ok(sampleOne.tiers.every((tier) => tier.rateOverride === null));
    assert.equal(Math.min(...sampleOne.tiers.map((tier) => tier.tDep)), 1);
    assert.equal(Math.max(...sampleOne.tiers.map((tier) => tier.tDep)), 18);

    const pairs = new Set(sampleOne.tiers.map((tier) => `${tier.tDep}:${tier.tLoan}`));
    assert.equal(pairs.size, 90, 'each waiting-month / repayment-term pair must occur exactly once');
    for (const tier of sampleOne.tiers) {
      assert.equal(tier.alpha, sampleOneAlpha(tier.tDep, tier.tLoan, 2));
    }
    assert.equal(sampleOneAlpha(1, 60, 0), 2.5);
    assert.equal(sampleOneAlpha(18, 12, 0), 225);
    assert.equal(sampleOneAlpha(1, 60, 2), 3.33);
    assert.equal(sampleOneAlpha(18, 12, 2), 300);
    assert.equal(sampleOneAlpha(1, 60, 4), 4);
    assert.equal(sampleOneAlpha(18, 12, 4), 360);
    assert.ok(Math.abs(sampleOne.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
    assert.ok(sampleOne.tiers.every((tier) => Math.abs(tier.allocation - 100 / 90) < 1e-9));
  });

  it('regenerates all states when the selected fee changes, using only the supported product options', () => {
    for (const feeRate of [0, 2, 4]) {
      const tiers = presetTiers('sample-1', feeRate);
      assert.equal(tiers.length, 90);
      assert.equal(tiers.find((tier) => tier.tDep === 18 && tier.tLoan === 12)?.alpha, sampleOneAlpha(18, 12, feeRate));
      assert.ok(tiers.every((tier) => tier.alpha === sampleOneAlpha(tier.tDep, tier.tLoan, feeRate)));
    }
  });
});

describe('sample plan two — Negin Farapouya, Bank Sepah', () => {
  const terms: number[] = [...FARAPOUYA.terms];

  it('is labelled «نمونه طرح دوم» and carries the published product parameters', () => {
    assert.equal(sampleTwo.name, 'نمونه طرح دوم');
    assert.equal(sampleTwo.contractType, 'murabaha');
    assert.equal(sampleTwo.rate, FARAPOUYA.rateBase, 'the base rate at the minimum waiting period');
    assert.deepEqual(sampleTwo.waitingRange, [FARAPOUYA.minWait, FARAPOUYA.maxWait]);
    assert.deepEqual(sampleTwo.repaymentTerms, [16, 24, 32, 40, 48, 56, 60]);
    assert.deepEqual(sampleTwo.alphaRange, [FARAPOUYA.alphaBase, FARAPOUYA.alphaCap]);
    assert.deepEqual(sampleTwo.tierRateRange, [FARAPOUYA.rateFloor, FARAPOUYA.rateBase]);
    assert.equal(sampleTwo.loanCap, 400_000_000, 'published individual ceiling: 4 billion rial');
    assert.equal(sampleTwo.minLoan, 10_000_000, 'published minimum facility: 100 million rial');
    assert.equal(sampleTwo.depositProfitRate, 0.01, 'the special short-term account pays 0.01%');
    assert.equal(sampleTwo.programCap, undefined, 'no aggregate programme ceiling is published for this product');
    assert.ok(sampleTwo.tiers.every((tier) => tier.minBalance === FARAPOUYA.minBalance));
  });

  it('rebuilds the benefit-point rule of the product', () => {
    // هر ماه انتظار بیشتر از حداقلِ ۲ ماه = یک امتیاز
    assert.equal(farapouyaPoints(2), 0);
    assert.equal(farapouyaPoints(12), 10);
    // اقساط بالاتر از سقف پایه (۴۸ ماه) امتیاز مصرف می‌کند: ۵۶ ← ۱ و ۶۰ ← ۲
    assert.equal(farapouyaTermPoints(16), 0);
    assert.equal(farapouyaTermPoints(48), 0);
    assert.equal(farapouyaTermPoints(56), 1);
    assert.equal(farapouyaTermPoints(60), 2);
    // سقف اقساط با انتظار بالا می‌رود و در ۶۰ ماه متوقف می‌شود
    assert.equal(farapouyaTermCeiling(2), 48);
    assert.equal(farapouyaTermCeiling(3), 56);
    assert.equal(farapouyaTermCeiling(4), 60);
    assert.equal(farapouyaTermCeiling(12), 60);
    // اقساط بالاتر از ۴۸ فقط با انتظارِ بیش از ۲ ماه
    assert.equal(farapouyaFeasible(2, 48), true);
    assert.equal(farapouyaFeasible(2, 56), false);
    assert.equal(farapouyaFeasible(2, 60), false);
    assert.equal(farapouyaFeasible(3, 56), true);
    assert.equal(farapouyaFeasible(3, 60), false);
    assert.equal(farapouyaFeasible(4, 60), true);
    // گام‌های لازم برای هر کران: ۹ گام تا نرخ ۵٪ و ۷ گام تا ضریب ۲۰۰٪
    assert.equal(FARAPOUYA_RATE_STEPS, 9);
    assert.equal(FARAPOUYA_ALPHA_STEPS, 7);
    // حالت پایهٔ محصول در حداقل انتظار
    const base = farapouyaMode(2, 16);
    assert.equal(base.alpha, 25);
    assert.equal(base.rate, 23);
    assert.equal(base.freePoints, 0);
  });

  it('ships every feasible wait/term pair exactly once', () => {
    const allPairs = (FARAPOUYA.maxWait - FARAPOUYA.minWait + 1) * terms.length;
    assert.equal(sampleTwo.tiers.length, allPairs - 3, 'three of the 77 pairs break the installment rule');
    assert.equal(sampleTwo.tiers.length, farapouyaModes().length);

    const pairs = new Set(sampleTwo.tiers.map((tier) => `${tier.tDep}:${tier.tLoan}`));
    assert.equal(pairs.size, sampleTwo.tiers.length, 'each waiting/term pair must occur exactly once');
    assert.ok(sampleTwo.tiers.every((tier) => terms.includes(tier.tLoan)));
    assert.ok(sampleTwo.tiers.every((tier) => tier.tDep >= FARAPOUYA.minWait && tier.tDep <= FARAPOUYA.maxWait));
    assert.ok(sampleTwo.tiers.every((tier) => farapouyaFeasible(tier.tDep, tier.tLoan)));
    assert.ok(sampleTwo.tiers.every((tier) => tier.tLoan <= farapouyaTermCeiling(tier.tDep)));
    assert.equal(Math.min(...sampleTwo.tiers.map((tier) => tier.tDep)), 2);
    assert.equal(Math.max(...sampleTwo.tiers.map((tier) => tier.tDep)), 12);
    assert.ok(Math.abs(sampleTwo.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
    assert.ok(sampleTwo.tiers.every((tier) => Math.abs(tier.allocation - 100 / sampleTwo.tiers.length) < 1e-9));
  });

  it('prices each mode from the reconstructed alpha and rate, inside the published ranges', () => {
    for (const tier of sampleTwo.tiers) {
      assert.equal(tier.alpha, farapouyaAlpha(tier.tDep, tier.tLoan), `${tier.name}: alpha`);
      assert.equal(tier.rateOverride, farapouyaRate(tier.tDep, tier.tLoan), `${tier.name}: rate`);
      assert.ok(tier.alpha >= FARAPOUYA.alphaBase && tier.alpha <= FARAPOUYA.alphaCap, `${tier.name}: alpha range`);
      assert.ok(
        (tier.rateOverride as number) >= FARAPOUYA.rateFloor && (tier.rateOverride as number) <= FARAPOUYA.rateBase,
        `${tier.name}: rate range`,
      );
      // هر دو روی نردبان‌های اعلام‌شدهٔ محصول می‌نشینند (گام ۲۵٪ و گام ۲٪)
      assert.equal((tier.alpha - FARAPOUYA.alphaBase) % FARAPOUYA.alphaStep, 0, `${tier.name}: alpha ladder`);
      assert.equal((FARAPOUYA.rateBase - (tier.rateOverride as number)) % FARAPOUYA.rateStep, 0, `${tier.name}: rate ladder`);
    }
    assert.equal(Math.min(...sampleTwo.tiers.map((tier) => tier.alpha)), 25);
    assert.equal(Math.max(...sampleTwo.tiers.map((tier) => tier.alpha)), 125);
    assert.equal(Math.min(...sampleTwo.tiers.map((tier) => tier.rateOverride as number)), 11);
    assert.equal(Math.max(...sampleTwo.tiers.map((tier) => tier.rateOverride as number)), 23);
  });

  it('moves alpha up and the rate down as the customer waits longer', () => {
    for (const term of terms) {
      const rows = sampleTwo.tiers.filter((tier) => tier.tLoan === term).sort((a, b) => a.tDep - b.tDep);
      assert.ok(rows.length >= 5, `term ${term} must appear across the waiting ladder`);
      const nonFalling = (values: number[]) => values.every((value, index) => index === 0 || value >= values[index - 1]);
      assert.ok(nonFalling(rows.map((tier) => tier.alpha)), `alpha must not fall with waiting at term ${term}`);
      assert.ok(
        nonFalling(rows.map((tier) => tier.rateOverride as number).map((rate) => -rate)),
        `the rate must not rise with waiting at term ${term}`,
      );
    }
    // مصرف امتیاز برای اقساطِ بلندتر، از سهم ضریب/نرخ همان حالت کم می‌کند
    for (const waiting of [4, 8, 12]) {
      const rows = sampleTwo.tiers.filter((tier) => tier.tDep === waiting).sort((a, b) => a.tLoan - b.tLoan);
      const shortest = rows[0];
      const longest = rows[rows.length - 1];
      assert.ok(longest.alpha <= shortest.alpha, `waiting ${waiting}: a longer term cannot raise alpha`);
      assert.ok(
        (longest.rateOverride as number) >= (shortest.rateOverride as number),
        `waiting ${waiting}: a longer term cannot lower the rate`,
      );
    }
  });

  it('documents that the two published extremes cannot be bought together', () => {
    // رسیدن هم‌زمان به ضریب ۲۰۰٪ و نرخ ۵٪ به ۱۶ امتیاز نیاز دارد؛ سقف انتظار ۱۲ ماه
    // یعنی حداکثر ۱۰ امتیاز، پس هیچ حالتی هر دو کران را با هم ندارد.
    assert.ok(FARAPOUYA_RATE_STEPS + FARAPOUYA_ALPHA_STEPS > farapouyaPoints(FARAPOUYA.maxWait));
    assert.ok(
      sampleTwo.tiers.every(
        (tier) => tier.alpha < FARAPOUYA.alphaCap || (tier.rateOverride as number) > FARAPOUYA.rateFloor,
      ),
    );
    // هر کران به‌تنهایی با صرفِ تمامِ امتیازها روی همان مزیت خریدنی است (۱۱ ماه انتظار
    // برای کف نرخ و ۹ ماه برای سقف ضریب کافی است) — اما فقط با ویرایش دستیِ حالت،
    // چون سیاست ترکیبیِ موتور امتیازها را بین دو مزیت تقسیم می‌کند.
    assert.ok(FARAPOUYA_RATE_STEPS <= farapouyaPoints(11), 'nine points are affordable by waiting 11 months');
    assert.ok(FARAPOUYA_ALPHA_STEPS <= farapouyaPoints(9), 'seven points are affordable by waiting 9 months');
    assert.equal(
      Math.max(FARAPOUYA.rateFloor, FARAPOUYA.rateBase - FARAPOUYA.rateStep * FARAPOUYA_RATE_STEPS),
      FARAPOUYA.rateFloor,
    );
    assert.equal(
      Math.min(FARAPOUYA.alphaCap, FARAPOUYA.alphaBase + FARAPOUYA.alphaStep * FARAPOUYA_ALPHA_STEPS),
      FARAPOUYA.alphaCap,
    );
    assert.ok(sampleTwo.tiers.every((tier) => tier.alpha < FARAPOUYA.alphaCap), 'the combined policy never maxes alpha');
    assert.ok(
      sampleTwo.tiers.every((tier) => (tier.rateOverride as number) > FARAPOUYA.rateFloor),
      'the combined policy never reaches the rate floor',
    );
    // کران‌های منتشرشده همچنان به‌عنوان دامنهٔ ویرایشِ الگو نگه داشته می‌شوند
    assert.deepEqual(sampleTwo.alphaRange, [FARAPOUYA.alphaBase, FARAPOUYA.alphaCap]);
    assert.deepEqual(sampleTwo.tierRateRange, [FARAPOUYA.rateFloor, FARAPOUYA.rateBase]);
  });

  it('keeps all tier values editable and inside the shared import/UI limits', () => {
    for (const tier of sampleTwo.tiers) {
      assert.ok(tier.tDep >= TIER_WAIT_MIN && tier.tDep <= TIER_WAIT_MAX, `${tier.name}: waiting period out of range`);
      assert.ok(tier.tLoan >= 6 && tier.tLoan <= 60, `${tier.name}: repayment term out of range`);
      assert.ok(tier.alpha >= 0 && tier.alpha <= TIER_ALPHA_MAX, `${tier.name}: alpha out of range`);
      assert.ok(
        (tier.rateOverride as number) >= 0 && (tier.rateOverride as number) <= IMPORT_RATE_MAX,
        `${tier.name}: rate out of range`,
      );
      assert.ok(tier.allocation >= 0 && tier.allocation <= 100, `${tier.name}: allocation out of range`);
    }
    assert.equal(presetTiers('sample-3').length, sampleTwo.tiers.length, 'loading the preset rebuilds the same matrix');
    assert.ok(presetTiers('sample-3').every((tier) => tier.id.length > 0));
  });

  it('prices every step above the cost of funds and satisfies the shipped optimizer constraints', () => {
    for (const tier of sampleTwo.tiers) {
      assert.ok(
        (tier.rateOverride as number) > sampleTwo.depositProfitRate,
        `${tier.name}: the loan rate must cover the deposit rate`,
      );
    }
    const kpis = simulate(presetInput('sample-3'), false).kpis;
    const holePct = (kpis.maxHole / kpis.netDeposit) * 100;
    assert.ok(holePct <= DEFAULT_CONSTRAINTS.maxHolePct, `liquidity hole ${holePct.toFixed(2)}% breaches the default cap`);
    assert.ok(!DEFAULT_CONSTRAINTS.requirePositiveMargin || kpis.netMargin > 0, 'the default constraints demand a non-negative margin');
    assert.ok(kpis.netInterestIncome > 0, 'loan income must exceed the deposit profit paid');
    assert.ok(kpis.leverage <= 1.8, `leverage ${kpis.leverage.toFixed(4)} is too aggressive for a shipped sample`);
    assert.ok(kpis.recoveryMonth !== null, 'sample two must recover before the horizon ends');
    assert.ok((kpis.recoveryMonth as number) <= 40, 'sample two must recover well inside the horizon');
    assert.ok(kpis.deficitMonths <= 30, 'too many months spent in deficit');
    assert.ok(kpis.endCum > 0, 'sample two must end the horizon with positive cumulative liquidity');
    assert.equal(kpis.commitmentsBeyondHorizon, 0, 'every maturity of this product fits inside the default horizon');
    assert.ok(kpis.totalProfitPaid > 0, 'the 0.01% deposit profit must still reach the cash-flow matrix');
  });
});

describe('generic tier labels', () => {
  it('uses Persian ordinal labels and remains unambiguous for longer lists', () => {
    assert.equal(tierLabel(0), 'حالت اول');
    assert.equal(tierLabel(1), 'حالت دوم');
    assert.equal(tierLabel(2), 'حالت سوم');
    assert.equal(tierLabel(19), 'حالت بیستم');
    assert.equal(tierLabel(20), 'حالت شمارهٔ ۲۱');
  });

  it('renumbers labels after a tier is inserted, removed or reordered', () => {
    const labeled = labelTiers([makeTier('a', 'عنوان قبلی'), makeTier('b', 'نام قدیمی')]);
    assert.deepEqual(labeled.map((tier) => tier.name), ['حالت اول', 'حالت دوم']);
  });
});

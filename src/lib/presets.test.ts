import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, DEFAULT_PRESET, labelTiers, PRESETS, tierLabel } from './presets';
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
const secondSample = PRESETS.find((preset) => preset.key === 'sample-3');
assert.ok(sampleOne);
assert.ok(secondSample);

describe('sample plan one — Negin Omid Zarin, Bank Sepah', () => {
  it('ships exactly two profiles, numbered ۱ و ۲, with the Negin profile as the default', () => {
    assert.equal(DEFAULT_PRESET, 'sample-1');
    /* کلید داخلی الگوی مرابحه همان `sample-3` مانده تا وضعیت ذخیره‌شدهٔ کاربران
       بی‌صدا خراب نشود؛ برچسب نمایشی اما پیوسته و «نمونه طرح دوم» است. */
    assert.deepEqual(
      PRESETS.map((preset) => preset.key),
      ['sample-1', 'sample-3'],
    );
    assert.deepEqual(
      PRESETS.map((preset) => preset.name),
      ['نمونه طرح اول', 'نمونه طرح دوم'],
    );
    assert.equal(PRESETS.some((preset) => preset.name.includes('نمونه طرح سوم')), false);
  });

  it('matches the publicly stated loan type, fee choices, headline ceiling and tenor options', () => {
    assert.equal(sampleOne.name, 'نمونه طرح اول');
    assert.equal(sampleOne.contractType, 'qard');
    assert.equal(sampleOne.rate, 2, 'the default should use the middle published fee option');
    assert.deepEqual(sampleOne.rateOptions, [0, 2, 4]);
    assert.equal(sampleOne.programCap, 1_000_000_000, 'published reports quote a 1-billion-toman total product ceiling');
    assert.equal(sampleOne.loanCap, 300_000_000, 'the individual simulation cap uses the conservative recent report');
    assert.deepEqual(sampleOne.waitingRange, [1, 18]);
    assert.deepEqual(sampleOne.repaymentTerms, [12, 24, 36, 48, 60]);
    assert.deepEqual(sampleOne.alphaRange, [2.5, 225]);
    assert.equal(sampleOne.depositProfitRate, 0);
    assert.equal(DEFAULT_CONFIG.qardFeeRate, 2);
    assert.equal(DEFAULT_CONFIG.loanCap, 300_000_000);
  });

  it('keeps every sample tier within the advertised wait/term and multiplier boundaries', () => {
    assert.ok(sampleOne.repaymentTerms);
    const terms = new Set(sampleOne.repaymentTerms);
    assert.ok(sampleOne.tiers.every((tier) => tier.tDep >= 1 && tier.tDep <= 18));
    assert.ok(sampleOne.tiers.every((tier) => terms.has(tier.tLoan)));
    assert.ok(sampleOne.tiers.every((tier) => tier.alpha >= 2.5 && tier.alpha <= 225));
    assert.equal(Math.min(...sampleOne.tiers.map((tier) => tier.tDep)), 1);
    assert.equal(Math.max(...sampleOne.tiers.map((tier) => tier.tDep)), 18);
    assert.deepEqual(
      [...new Set(sampleOne.tiers.map((tier) => tier.tLoan))].sort((a, b) => a - b),
      [...sampleOne.repaymentTerms],
    );
    assert.ok(Math.abs(sampleOne.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
  });

  it('spreads the six rungs across the advertised 1–18 month waiting range', () => {
    /* پیش‌تر پنج رده از شش رده روی انتظار ۱۸ ماه گیر کرده بودند و کل بازهٔ
       اعلامی محصول (۱ تا ۱۸ ماه) در طرح دیده نمی‌شد. */
    const waits = sampleOne.tiers.map((tier) => tier.tDep);
    assert.equal(new Set(waits).size, waits.length, 'every rung must have its own waiting period');
    assert.deepEqual(waits, [...waits].sort((a, b) => a - b), 'rungs must be listed by rising waiting period');
    assert.ok(
      waits.some((wait) => wait <= 3) && waits.some((wait) => wait >= 12),
      'the rungs must cover both ends of the advertised range',
    );
    const gaps = waits.slice(1).map((wait, index) => wait - waits[index]);
    assert.ok(Math.max(...gaps) <= 6, `the rungs leave a ${Math.max(...gaps)}-month hole in the waiting range`);
  });

  it('prices the rungs with a descending fee ladder drawn from the published options', () => {
    const fees = sampleOne.tiers.map((tier) => tier.rateOverride as number);
    assert.ok(fees.every((fee) => sampleOne.rateOptions?.includes(fee)), 'every default fee must be a published option');
    assert.equal(new Set(fees).size, sampleOne.rateOptions?.length, 'each published fee option must appear at least once');
    const risingWaits = sampleOne.tiers.map((tier) => tier.tDep);
    assert.deepEqual(risingWaits, [...risingWaits].sort((a, b) => a - b));
    assert.ok(
      fees.every((fee, index) => index === 0 || fee <= fees[index - 1]),
      'the default fee must never rise with the waiting period',
    );
    assert.ok(fees[0] > fees[fees.length - 1], 'the shortest wait must default to the highest fee');
  });
});

describe('sample plan two', () => {
  it('ships exactly the requested waiting, installment, multiplier and rate ranges', () => {
    const terms = [16, 24, 32, 40, 48, 56, 60];
    assert.equal(secondSample.contractType, 'murabaha');
    assert.equal(secondSample.tiers.length, terms.length);
    assert.deepEqual(secondSample.waitingRange, [2, 12]);
    assert.deepEqual(secondSample.repaymentTerms, terms);
    assert.deepEqual(secondSample.alphaRange, [25, 200]);
    assert.deepEqual(secondSample.tierRateRange, [5, 23]);
    assert.deepEqual(
      secondSample.tiers.map((tier) => tier.tLoan),
      terms,
    );
    assert.deepEqual(
      secondSample.tiers.map((tier) => tier.rateOverride),
      [5, 8, 11, 14, 17, 20, 23],
    );
    assert.equal(Math.min(...secondSample.tiers.map((tier) => tier.tDep)), 2);
    assert.equal(Math.max(...secondSample.tiers.map((tier) => tier.tDep)), 12);
    assert.equal(Math.min(...secondSample.tiers.map((tier) => tier.alpha)), 25);
    assert.equal(Math.max(...secondSample.tiers.map((tier) => tier.alpha)), 200);
    assert.ok(Math.abs(secondSample.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
  });

  it('is a monotone ladder in waiting time, repayment term, rate and alpha', () => {
    const rising = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1]);
    assert.ok(rising(secondSample.tiers.map((tier) => tier.tDep)));
    assert.ok(rising(secondSample.tiers.map((tier) => tier.tLoan)));
    assert.ok(rising(secondSample.tiers.map((tier) => tier.rateOverride as number)));
    assert.ok(rising(secondSample.tiers.map((tier) => tier.alpha)));
    assert.equal(secondSample.tiers[0].tDep, 2);
    assert.equal(secondSample.tiers[0].tLoan, 16);
    assert.equal(secondSample.tiers[0].rateOverride, 5);
    assert.equal(secondSample.tiers.at(-1)?.tDep, 12);
    assert.equal(secondSample.tiers.at(-1)?.tLoan, 60);
    assert.equal(secondSample.tiers.at(-1)?.rateOverride, 23);
  });

  it('keeps all tier values editable and inside the shared import/UI limits', () => {
    for (const tier of secondSample.tiers) {
      assert.ok(tier.tDep >= TIER_WAIT_MIN && tier.tDep <= TIER_WAIT_MAX, `${tier.name}: waiting period out of range`);
      assert.ok(tier.tLoan >= 6 && tier.tLoan <= 60, `${tier.name}: repayment term out of range`);
      assert.ok(tier.alpha >= 0 && tier.alpha <= TIER_ALPHA_MAX, `${tier.name}: alpha out of range`);
      assert.ok(
        (tier.rateOverride as number) >= 0 && (tier.rateOverride as number) <= IMPORT_RATE_MAX,
        `${tier.name}: rate out of range`,
      );
      assert.ok(tier.allocation >= 0 && tier.allocation <= 100, `${tier.name}: allocation out of range`);
    }
  });

  it('prices every step above the cost of funds and satisfies the shipped optimizer constraints', () => {
    for (const tier of secondSample.tiers) {
      assert.ok(
        (tier.rateOverride as number) > secondSample.depositProfitRate,
        `${tier.name}: the loan rate must cover the deposit rate`,
      );
    }
    const kpis = simulate(presetInput('sample-3'), false).kpis;
    const holePct = (kpis.maxHole / kpis.netDeposit) * 100;
    assert.ok(holePct <= DEFAULT_CONSTRAINTS.maxHolePct, `liquidity hole ${holePct.toFixed(2)}% breaches the default cap`);
    assert.ok(!DEFAULT_CONSTRAINTS.requirePositiveMargin || kpis.netMargin > 0, 'the default constraints demand a non-negative margin');
    assert.ok(kpis.netInterestIncome > 0, 'loan income must exceed the deposit profit paid');
    assert.ok(kpis.leverage <= 1.8, `leverage ${kpis.leverage.toFixed(4)} is too aggressive for a shipped sample`);
    assert.ok(kpis.recoveryMonth !== null, 'sample three must recover before the horizon ends');
    assert.ok((kpis.recoveryMonth as number) <= 40, 'sample three must recover well inside the horizon');
    assert.ok(kpis.deficitMonths <= 30, 'too many months spent in deficit');
    assert.ok(kpis.endCum > 0, 'sample three must end the horizon with positive cumulative liquidity');
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

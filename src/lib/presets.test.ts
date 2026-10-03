import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, DEFAULT_PRESET, labelTiers, presetTiers, PRESETS, sampleOneAlpha, tierLabel } from './presets';
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
const sampleThree = PRESETS.find((preset) => preset.key === 'sample-3');
assert.ok(sampleOne);
assert.ok(sampleThree);

describe('sample plan one — Negin Omid Zarin, Bank Sepah', () => {
  it('is the default profile and replaces the removed second sample', () => {
    assert.equal(DEFAULT_PRESET, 'sample-1');
    assert.deepEqual(
      PRESETS.map((preset) => preset.key),
      ['sample-1', 'sample-3'],
    );
    assert.equal(PRESETS.some((preset) => preset.name.includes('نمونه طرح دوم')), false);
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

describe('sample plan three', () => {
  it('ships exactly the requested waiting, installment, multiplier and rate ranges', () => {
    const terms = [16, 24, 32, 40, 48, 56, 60];
    assert.equal(sampleThree.contractType, 'murabaha');
    assert.equal(sampleThree.tiers.length, terms.length);
    assert.deepEqual(sampleThree.waitingRange, [2, 12]);
    assert.deepEqual(sampleThree.repaymentTerms, terms);
    assert.deepEqual(sampleThree.alphaRange, [25, 200]);
    assert.deepEqual(sampleThree.tierRateRange, [5, 23]);
    assert.deepEqual(
      sampleThree.tiers.map((tier) => tier.tLoan),
      terms,
    );
    assert.deepEqual(
      sampleThree.tiers.map((tier) => tier.rateOverride),
      [5, 8, 11, 14, 17, 20, 23],
    );
    assert.equal(Math.min(...sampleThree.tiers.map((tier) => tier.tDep)), 2);
    assert.equal(Math.max(...sampleThree.tiers.map((tier) => tier.tDep)), 12);
    assert.equal(Math.min(...sampleThree.tiers.map((tier) => tier.alpha)), 25);
    assert.equal(Math.max(...sampleThree.tiers.map((tier) => tier.alpha)), 200);
    assert.ok(Math.abs(sampleThree.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
  });

  it('is a monotone ladder in waiting time, repayment term, rate and alpha', () => {
    const rising = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1]);
    assert.ok(rising(sampleThree.tiers.map((tier) => tier.tDep)));
    assert.ok(rising(sampleThree.tiers.map((tier) => tier.tLoan)));
    assert.ok(rising(sampleThree.tiers.map((tier) => tier.rateOverride as number)));
    assert.ok(rising(sampleThree.tiers.map((tier) => tier.alpha)));
    assert.equal(sampleThree.tiers[0].tDep, 2);
    assert.equal(sampleThree.tiers[0].tLoan, 16);
    assert.equal(sampleThree.tiers[0].rateOverride, 5);
    assert.equal(sampleThree.tiers.at(-1)?.tDep, 12);
    assert.equal(sampleThree.tiers.at(-1)?.tLoan, 60);
    assert.equal(sampleThree.tiers.at(-1)?.rateOverride, 23);
  });

  it('keeps all tier values editable and inside the shared import/UI limits', () => {
    for (const tier of sampleThree.tiers) {
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
    for (const tier of sampleThree.tiers) {
      assert.ok(
        (tier.rateOverride as number) > sampleThree.depositProfitRate,
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

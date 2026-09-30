import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labelTiers, PRESETS, tierLabel } from './presets';
import { simulate } from './engine';
import { presetInput } from './testUtils';
import { IMPORT_RATE_MAX, TIER_ALPHA_MAX } from './limits';
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

describe('sample plan three', () => {
  const sample = PRESETS.find((preset) => preset.key === 'sample-3');
  assert.ok(sample);

  it('ships the approved rate card as editable tier overrides across the 12–60 month term range', () => {
    assert.deepEqual(sample.tiers.map((tier) => tier.rateOverride), [
      5, 9, 10, 13, 15, 16, 17, 18, 19, 20, 21, 23,
    ]);
    assert.equal(sample.tiers.length, 12);
    assert.equal(Math.min(...sample.tiers.map((tier) => tier.tLoan)), 12);
    assert.equal(Math.max(...sample.tiers.map((tier) => tier.tLoan)), 60);
    assert.ok(sample.tiers.every((tier) => tier.rateOverride !== null));
    assert.ok(Math.abs(sample.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
  });

  it('is a monotone ladder — waiting period, repayment term, rate and alpha all rise together', () => {
    const rising = (values: number[], strict: boolean) =>
      values.every((v, i) => i === 0 || (strict ? v > values[i - 1] : v >= values[i - 1]));

    assert.ok(rising(sample.tiers.map((tier) => tier.tDep), false), 'waiting period must never step back down');
    assert.ok(rising(sample.tiers.map((tier) => tier.tLoan), true), 'repayment term must strictly increase');
    assert.ok(
      rising(
        sample.tiers.map((tier) => tier.rateOverride as number),
        true,
      ),
      'the contract rate must strictly increase with the wait',
    );
    assert.ok(rising(sample.tiers.map((tier) => tier.alpha), false), 'a longer wait must not shrink the loan multiple');

    assert.equal(sample.tiers[0].tDep, 3, 'the ladder starts from the shortest approved waiting period');
    assert.equal(sample.tiers[0].tLoan, 12, '…with the shortest repayment term');
    assert.equal(sample.tiers[0].rateOverride, 5, '…and the cheapest rate');
    assert.equal(sample.tiers[11].tDep, 12);
    assert.equal(sample.tiers[11].tLoan, 60);
    assert.equal(sample.tiers[11].rateOverride, 23);
  });

  it('keeps every rate inside the range the tier builder and the JSON importer accept', () => {
    for (const tier of sample.tiers) {
      assert.ok(tier.tDep >= 1 && tier.tDep <= 12, `${tier.name}: waiting period out of the builder range`);
      assert.ok(tier.tLoan >= 6 && tier.tLoan <= 60, `${tier.name}: repayment term out of the builder range`);
      assert.ok(tier.alpha >= 0 && tier.alpha <= TIER_ALPHA_MAX, `${tier.name}: alpha out of the builder range`);
      assert.ok(
        (tier.rateOverride as number) >= 0 && (tier.rateOverride as number) <= IMPORT_RATE_MAX,
        `${tier.name}: rate out of the importable range`,
      );
      assert.ok(tier.allocation >= 0 && tier.allocation <= 100, `${tier.name}: allocation out of range`);
    }
  });

  it('prices every step above the cost of funds, so the ladder can break even', () => {
    // اگر نرخ سود سپرده از پله‌های ارزان جدول نرخ (۵٪، ۹٪، ۱۰٪…) بالاتر باشد،
    // سود پرداختی به سپرده‌گذار از درآمد تسهیلات بیشتر می‌شود و طرح با هر
    // چینش پله‌ای زیان‌ده می‌ماند؛ کف زیان همان سود سپرده است. این آزمون همان
    // دام را نگهبانی می‌کند.
    for (const tier of sample.tiers) {
      assert.ok(
        (tier.rateOverride as number) > sample.depositProfitRate,
        `${tier.name}: lends at ${tier.rateOverride}% which does not cover the ${sample.depositProfitRate}% deposit rate`,
      );
    }
  });

  it('loads into a design that satisfies the shipped default optimizer constraints', () => {
    const kpis = simulate(presetInput('sample-3'), false).kpis;
    const holePct = (kpis.maxHole / kpis.netDeposit) * 100;

    // همان قیدهایی که بهینه‌یاب به‌طور پیش‌فرض اعمال می‌کند
    assert.ok(holePct <= DEFAULT_CONSTRAINTS.maxHolePct, `liquidity hole ${holePct.toFixed(2)}% breaches the default cap`);
    assert.ok(
      !DEFAULT_CONSTRAINTS.requirePositiveMargin || kpis.netMargin > 0,
      'the default constraints demand a non-negative margin',
    );
    assert.ok(kpis.netInterestIncome > 0, 'loan income must exceed the deposit profit paid');

    // کیفیت خودِ طرح، فراتر از قیدهای پیش‌فرض (maxLeverage پیش‌فرض صفر است،
    // یعنی بدون سقف؛ این آستانه‌ها انتظارات کیفی خودِ الگو هستند)
    assert.ok(kpis.leverage <= 1.8, `leverage ${kpis.leverage.toFixed(4)} is too aggressive for a shipped sample`);
    assert.ok(kpis.recoveryMonth !== null, 'sample three must climb back above zero before the horizon ends');
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

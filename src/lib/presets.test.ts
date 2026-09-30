import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labelTiers, PRESETS, tierLabel } from './presets';
import { simulate } from './engine';
import { presetInput } from './testUtils';
import { IMPORT_RATE_MAX, TIER_ALPHA_MAX } from './limits';
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

  it('ships all report rates as editable tier overrides across the 12–60 month term range', () => {
    assert.deepEqual(sample.tiers.map((tier) => tier.rateOverride), [
      18, 19, 20, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 28, 29, 30,
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

    assert.equal(sample.tiers[0].tDep, 1, 'the ladder starts from the shortest waiting period');
    assert.equal(sample.tiers[0].tLoan, 12, '…with the shortest repayment term');
    assert.equal(sample.tiers[0].rateOverride, 18, '…and the cheapest rate');
    assert.equal(sample.tiers[11].tDep, 12);
    assert.equal(sample.tiers[11].tLoan, 60);
    assert.equal(sample.tiers[11].rateOverride, 30);
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

  it('loads into a design whose liquidity recovers inside the horizon', () => {
    const kpis = simulate(presetInput('sample-3'), false).kpis;
    assert.ok(kpis.recoveryMonth !== null, 'sample three must climb back above zero before the horizon ends');
    assert.ok(kpis.endCum > 0, 'sample three must end the horizon with positive cumulative liquidity');
    assert.ok(kpis.netMargin > -8e9, 'sample three must stay within the loss band of the other two samples');
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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labelTiers, PRESETS, tierLabel } from './presets';
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
  it('ships all report rates as editable tier overrides across the 12–60 month term range', () => {
    const sample = PRESETS.find((preset) => preset.key === 'sample-3');
    assert.ok(sample);
    assert.deepEqual(sample.tiers.map((tier) => tier.rateOverride), [5, 9, 10, 13, 15, 16, 17, 18, 19, 20, 21, 23]);
    assert.equal(sample.tiers.length, 12);
    assert.equal(Math.min(...sample.tiers.map((tier) => tier.tLoan)), 12);
    assert.equal(Math.max(...sample.tiers.map((tier) => tier.tLoan)), 60);
    assert.ok(sample.tiers.every((tier) => tier.rateOverride !== null));
    assert.ok(Math.abs(sample.tiers.reduce((sum, tier) => sum + tier.allocation, 0) - 100) < 1e-9);
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

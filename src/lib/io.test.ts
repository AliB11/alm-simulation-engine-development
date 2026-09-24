import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeState } from './io';

describe('scenario import validation', () => {
  it('rejects payloads that contain no recognizable section', () => {
    assert.equal(sanitizeState({}), null);
    assert.equal(sanitizeState({ foo: 1, bar: 'x' }), null);
    assert.equal(sanitizeState([]), null);
    assert.equal(sanitizeState('scenario'), null);
    assert.equal(sanitizeState(null), null);
    assert.equal(sanitizeState(42), null);
  });

  it('accepts payloads with at least one valid section', () => {
    assert.deepEqual(sanitizeState({ currency: 'rial' }), { currency: 'rial' });
    assert.deepEqual(sanitizeState({ tiers: [] }), { tiers: [] });
    assert.ok(sanitizeState({ config: { horizon: '48' } })?.config?.horizon === 48);
  });

  it('clamps imported numbers into the ranges the engine expects', () => {
    const state = sanitizeState({
      config: { horizon: 1e9, reserveRatio: -5, interbankRate: NaN, contractType: 'usury' },
      behavior: { takeUpRate: 400, totalDeposit: '50000000000' },
      tiers: [{ id: 'x', tDep: 99, tLoan: -3, alpha: NaN, minBalance: -1, allocation: 250, rateOverride: 99 }],
    });
    assert.equal(state?.config?.horizon, 120);
    assert.equal(state?.config?.reserveRatio, 0);
    assert.equal(state?.config?.interbankRate, 23);
    assert.equal(state?.config?.contractType, 'qard');
    assert.equal(state?.behavior?.takeUpRate, 100);
    assert.equal(state?.behavior?.totalDeposit, 50_000_000_000);
    const t = state?.tiers?.[0];
    assert.equal(t?.tDep, 12);
    assert.equal(t?.tLoan, 6);
    assert.equal(t?.alpha, 100);
    assert.equal(t?.minBalance, 0);
    assert.equal(t?.allocation, 100);
    assert.equal(t?.rateOverride, 60);
  });

  it('de-duplicates imported tier ids so React keys stay unique', () => {
    const state = sanitizeState({ tiers: [{ id: 'dup' }, { id: 'dup' }, {}] });
    const ids = state?.tiers?.map((t) => t.id) ?? [];
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 3);
  });
});

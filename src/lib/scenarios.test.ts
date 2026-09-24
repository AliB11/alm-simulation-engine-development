import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configDiffs, snapshotSlot, SLOT_META } from './scenarios';
import { simulate } from './engine';
import { presetInput } from './testUtils';

describe('scenario comparison helpers', () => {
  it('describes input differences in Persian digits and contract names', () => {
    const a = presetInput('nikvam');
    const b = presetInput('negin');
    const ka = simulate(a, false).kpis;
    const kb = simulate(b, false).kpis;
    const slotA = snapshotSlot('A', a, ka, 'پایه');
    const slotB = snapshotSlot('B', b, kb, 'جایگزین');
    const diffs = configDiffs(slotA, slotB);

    assert.ok(diffs.some((d) => d.startsWith('سود سپرده:') && d.includes('۰') && d.includes('۲۰')));
    assert.ok(diffs.some((d) => d.includes('قرض‌الحسنه') && d.includes('مرابحه')));
    assert.ok(diffs.every((d) => !d.includes('qard') && !d.includes('murabaha')));
    assert.ok(diffs.every((d) => !/\d/.test(d)), 'diffs must not leak Latin digits');
    assert.equal(slotA.name, 'پایه');
    assert.ok(slotA.savedAt > 0);
    assert.equal(SLOT_META.A.label, 'سناریوی A');
  });

  it('falls back to an automatic Persian name and does not mutate the source input', () => {
    const input = presetInput('mehrabani');
    const before = JSON.stringify(input);
    const slot = snapshotSlot('C', input, simulate(input, false).kpis);
    assert.ok(slot.name.startsWith('سناریوی C'));
    assert.equal(JSON.stringify(input), before);
    assert.notEqual(slot.tiers, input.tiers, 'the snapshot must be a copy');
    slot.tiers[0].alpha = 1;
    assert.notEqual(input.tiers[0].alpha, 1);
  });

  it('reports no diffs for an identical pair', () => {
    const input = presetInput('nikvam');
    const kpis = simulate(input, false).kpis;
    const a = snapshotSlot('A', input, kpis, 'یک');
    const b = snapshotSlot('B', input, kpis, 'دو');
    assert.deepEqual(configDiffs(a, b), []);
  });
});

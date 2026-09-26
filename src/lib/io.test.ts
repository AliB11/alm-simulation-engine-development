import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLedgerCsv, sanitizeSlots, sanitizeState } from './io';
import { simulate } from './engine';
import { presetInput } from './testUtils';

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

describe('general ledger CSV export', () => {
  it('emits one signed row per event plus a reconciling total', () => {
    const input = presetInput('sample-3');
    const result = simulate(input, true);
    const csv = buildLedgerCsv(result.rows, 1, 'تومان');
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    const header = lines[0].split(',');
    assert.equal(header[0], 'ماه');
    assert.ok(header.some((h) => h.includes('رویداد')));
    assert.ok(header.some((h) => h.includes('جهت')));

    const eventCount = result.rows.reduce((s, r) => s + r.events.length, 0);
    // سطرهای بدنه = رویدادها + یک سطر جمع کل
    assert.equal(lines.length, 1 + eventCount + 1);

    const body = lines.slice(1, 1 + eventCount);
    let sum = 0;
    for (const line of body) {
      const cells = line.split(',');
      const amount = Number(cells[6]);
      assert.ok(Number.isFinite(amount));
      const direction = cells[7].replace(/"/g, '');
      assert.ok(direction === 'ورودی' ? amount > 0 : amount < 0, `sign must match direction: ${line}`);
      sum += amount;
    }
    const totalLine = lines[lines.length - 1].split(',');
    assert.equal(totalLine[1].replace(/"/g, ''), 'جمع کل');
    assert.ok(Math.abs(Number(totalLine[6]) - sum) <= eventCount, 'total row must reconcile the ledger');

    // ماندهٔ تسهیلات هر سطر باید با همان ماه در ماتریس یکی باشد
    const firstRow = result.rows.find((r) => r.events.length > 0)!;
    const matching = body.find((l) => Number(l.split(',')[0]) === firstRow.t)!;
    assert.equal(Number(matching.split(',')[11]), Math.round(firstRow.loanBook));
  });

  it('scales amounts with the display factor and escapes embedded quotes', () => {
    const input = presetInput('sample-2');
    const result = simulate(input, true);
    const toman = buildLedgerCsv(result.rows, 1, 'تومان');
    const rial = buildLedgerCsv(result.rows, 10, 'ریال');
    const tomanLines = toman.replace(/^\uFEFF/, '').split('\n');
    const rialLines = rial.replace(/^\uFEFF/, '').split('\n');
    assert.equal(tomanLines.length, rialLines.length);
    const t = tomanLines[1].split(',');
    const r = rialLines[1].split(',');
    assert.ok(Math.abs(Number(r[6]) - Number(t[6]) * 10) <= 10);
    assert.ok(tomanLines[0].includes('تومان') && rialLines[0].includes('ریال'));

    // نام پله با نقل‌قول دوتایی باید به‌شکل RFC4180 فرار کند
    const quoted = simulate(
      { ...input, tiers: input.tiers.map((x, i) => (i === 0 ? { ...x, name: 'پله "ویژه", آزمایش' } : x)) },
      true,
    );
    const csv = buildLedgerCsv(quoted.rows, 1, 'تومان');
    assert.ok(csv.includes('"پله ""ویژه""، آزمایش"') || csv.includes('"پله ""ویژه"", آزمایش"'));
  });

  it('produces a header-only file when there is nothing to report', () => {
    const csv = buildLedgerCsv([], 1, 'تومان');
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    assert.equal(lines.length, 2, 'header plus the total row');
    assert.equal(lines[1].split(',')[6], '0');
  });
});

describe('scenario slot persistence', () => {
  const validSlot = () => {
    const input = presetInput('sample-2');
    return {
      name: 'سناریوی آزمایشی',
      savedAt: 1_700_000_000_000,
      config: input.config,
      tiers: input.tiers,
      behavior: input.behavior,
      schedule: input.schedule,
      kpis: simulate(input, false).kpis,
    };
  };

  it('round-trips valid slots and ignores unknown ones', () => {
    const slots = sanitizeSlots({ A: validSlot(), B: null, C: { foo: 1 }, D: validSlot() });
    assert.ok(slots.A);
    assert.equal(slots.B, null);
    assert.equal(slots.C, null, 'a payload without config/tiers/behavior/kpis is not a scenario');
    assert.ok(!('D' in slots), 'unknown slot ids are dropped');
    assert.deepEqual(Object.keys(slots), ['A', 'B', 'C']);
    assert.equal(slots.A?.name, 'سناریوی آزمایشی');
    assert.equal(slots.A?.kpis.maxHole, simulate(presetInput('sample-2'), false).kpis.maxHole);
  });

  it('clamps hostile numbers inside a saved slot', () => {
    const raw = validSlot() as Record<string, unknown>;
    raw.config = { ...(raw.config as object), horizon: 1e9, defaultRate: NaN, interbankRate: -5 };
    raw.behavior = { ...(raw.behavior as object), takeUpRate: 900, totalDeposit: 'abc' };
    raw.tiers = [{ id: 'x', tDep: 99, tLoan: -3, alpha: NaN, allocation: 500 }];
    raw.kpis = { ...(raw.kpis as object), maxHole: 'not-a-number', tippingPoint: null, endCum: 1e30 };
    raw.name = 'x'.repeat(500);
    raw.savedAt = 'yesterday';
    const slots = sanitizeSlots({ A: raw });
    const s = slots.A!;
    assert.equal(s.config.horizon, 120);
    assert.equal(s.config.defaultRate, 0);
    assert.equal(s.config.interbankRate, 0);
    assert.equal(s.behavior.takeUpRate, 100);
    assert.equal(s.behavior.totalDeposit, 50_000_000_000);
    assert.equal(s.tiers[0].tDep, 12);
    assert.equal(s.tiers[0].tLoan, 6);
    assert.equal(s.tiers[0].alpha, 100);
    assert.equal(s.tiers[0].allocation, 100);
    assert.equal(s.kpis.maxHole, 0, 'an unparsable KPI falls back to the neutral zero');
    assert.equal(s.kpis.tippingPoint, null);
    assert.equal(s.kpis.endCum, 1e30);
    assert.ok(s.name.length <= 60);
    assert.ok(Number.isFinite(s.savedAt));
  });

  it('never throws on garbage input', () => {
    for (const junk of [null, undefined, 42, 'slots', [], {}, { A: 1, B: [], C: 'x' }]) {
      const slots = sanitizeSlots(junk);
      assert.deepEqual(Object.keys(slots), ['A', 'B', 'C']);
      assert.equal(slots.A, null);
    }
  });

  it('keeps regulatory coefficients inside their legal ranges', () => {
    const state = sanitizeState({ regulatory: { stressRunoff: -3, stableWeight: 400, loanWeight: 'x' } });
    assert.equal(state?.regulatory?.stressRunoff, 0);
    assert.equal(state?.regulatory?.stableWeight, 100);
    assert.equal(state?.regulatory?.loanWeight, 85);
    assert.equal(sanitizeState({ regulatory: 'nope' })?.regulatory, undefined);
  });
});

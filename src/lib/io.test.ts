import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLedgerCsv, loadState, sanitizeSlots, sanitizeState } from './io';
import { DEFAULT_CONFIG, presetTiers, PRESETS } from './presets';
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
    assert.equal(t?.tDep, 18);
    assert.equal(t?.tLoan, 6);
    assert.equal(t?.alpha, 100);
    assert.equal(t?.minBalance, 0);
    assert.equal(t?.allocation, 100);
    assert.equal(t?.rateOverride, 60);
  });

  it('does not revive the removed sample plan two from an imported scenario', () => {
    const state = sanitizeState({ activePreset: 'sample-2', tiers: [] });
    assert.ok(state);
    assert.deepEqual(state.tiers, []);
    assert.equal('activePreset' in state, false);
  });

  it('drops an active-profile label when imported tiers use obsolete repayment terms', () => {
    const state = sanitizeState({
      activePreset: 'sample-3',
      tiers: [{ id: 'legacy', tDep: 3, tLoan: 12, alpha: 60, allocation: 100, rateOverride: 5 }],
    });
    assert.equal(state?.activePreset, null);
    assert.equal(state?.tiers?.[0].tLoan, 12, 'the imported user tier itself should be preserved');
  });

  it('validates the active sample-one multiplier range against its selected fee', () => {
    for (const feeRate of [0, 2, 4]) {
      const state = sanitizeState({
        activePreset: 'sample-1',
        config: { ...DEFAULT_CONFIG, qardFeeRate: feeRate },
        tiers: presetTiers('sample-1', feeRate),
      });
      assert.equal(state?.activePreset, 'sample-1', `fee ${feeRate}% must accept its own regenerated tiers`);
    }
    const unsupported = sanitizeState({
      activePreset: 'sample-1',
      config: { ...DEFAULT_CONFIG, qardFeeRate: 3 },
      tiers: presetTiers('sample-1', 2),
    });
    assert.equal(unsupported?.activePreset, null, 'a custom fee must not be misidentified as the published preset');
  });

  it('migrates a persisted default sample two to the new sample-one preset', () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const saved = JSON.stringify({
      activePreset: 'sample-2',
      config: {
        contractType: 'qard',
        qardFeeRate: 4,
        loanCap: 300_000_000,
        depositProfitRate: 0,
        horizon: 60,
      },
      tiers: [{ id: 'legacy', tDep: 4, tLoan: 12, alpha: 110, allocation: 100 }],
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => saved } as unknown as Storage,
    });
    try {
      const state = loadState();
      assert.equal(state?.activePreset, 'sample-1');
      assert.equal(state?.config?.loanCap, 300_000_000);
      assert.equal(state?.config?.qardFeeRate, 4, 'a supported user fee choice should be preserved');
      assert.equal(state?.tiers?.length, 90, 'the complete mode matrix should replace the removed preset tiers');
      assert.equal(
        state?.tiers?.find((tier) => tier.tDep === 18 && tier.tLoan === 12)?.alpha,
        360,
        'the preserved 4% fee must regenerate the 4%-specific multiplier matrix',
      );
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('does not regenerate a saved custom design as the preset when its fee is not a product option', () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const saved = JSON.stringify({
      activePreset: 'sample-1',
      config: { ...DEFAULT_CONFIG, qardFeeRate: 3 },
      tiers: [{ id: 'custom', tDep: 4, tLoan: 12, alpha: 110, allocation: 100, rateOverride: null }],
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => saved } as unknown as Storage,
    });
    try {
      const state = loadState();
      assert.equal(state?.activePreset, null);
      assert.equal(state?.tiers?.length, 1, 'the user-defined tier must not be replaced with the 90-mode preset');
      assert.equal(state?.tiers?.[0].id, 'custom');
      assert.equal(state?.config?.qardFeeRate, 3);
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('does not apply the removed preset migration across a user-changed contract', () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const saved = JSON.stringify({
      activePreset: 'sample-2',
      config: { ...DEFAULT_CONFIG, contractType: 'murabaha' },
      tiers: [{ id: 'custom', tDep: 4, tLoan: 12, alpha: 110, allocation: 100 }],
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => saved } as unknown as Storage,
    });
    try {
      const state = loadState();
      assert.equal(state?.activePreset, null);
      assert.equal(state?.config?.contractType, 'murabaha');
      assert.equal(state?.tiers?.[0].tDep, 4, 'the custom user design should be preserved');
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('refreshes active sample-one and sample-three tiers after their terms change, preserving user configuration', () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let saved = '';
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => saved } as unknown as Storage,
    });
    const cases = [
      {
        key: 'sample-1',
        contractType: 'qard',
        oldTerms: [6, 12, 24, 12, 36, 60],
        waiting: [1, 3, 6, 12, 12, 12],
      },
      {
        key: 'sample-3',
        contractType: 'murabaha',
        oldTerms: [12, 16, 21, 25, 29, 34, 38, 43, 47, 51, 56, 60],
        waiting: [3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12],
      },
    ] as const;

    try {
      for (const entry of cases) {
        const config = {
          ...DEFAULT_CONFIG,
          contractType: entry.contractType,
          qardFeeRate: 4,
          loanCap: 450_000_000,
        };
        saved = JSON.stringify({
          activePreset: entry.key,
          config,
          tiers: entry.oldTerms.map((tLoan, index) => ({
            id: `legacy-${index}`,
            tDep: entry.waiting[index],
            tLoan,
            alpha: 60,
            allocation: 100 / entry.oldTerms.length,
            rateOverride: entry.contractType === 'qard' ? null : 5,
          })),
        });
        const state = loadState();
        const currentPreset = PRESETS.find((preset) => preset.key === entry.key);
        assert.ok(currentPreset);
        assert.equal(state?.activePreset, entry.key);
        assert.deepEqual(state?.tiers?.map((tier) => tier.tLoan), currentPreset.tiers.map((tier) => tier.tLoan));
        assert.equal(state?.config?.contractType, entry.contractType);
        assert.equal(state?.config?.loanCap, 450_000_000);
        assert.equal(state?.config?.qardFeeRate, 4);
      }
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
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
    const input = presetInput('sample-1');
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
    const input = presetInput('sample-1');
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
    assert.equal(slots.A?.kpis.maxHole, simulate(presetInput('sample-1'), false).kpis.maxHole);
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
    assert.equal(s.tiers[0].tDep, 18);
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
    const state = sanitizeState({
      regulatory: {
        stressRunoff: -3,
        stableWeight: 400,
        loanWeight: 'x',
        wholesaleShare: 150,
        wholesaleRunoff: -5,
        hqlaHaircut: 'x',
      },
    });
    assert.equal(state?.regulatory?.stressRunoff, 0);
    assert.equal(state?.regulatory?.stableWeight, 100);
    assert.equal(state?.regulatory?.loanWeight, 85);
    assert.equal(state?.regulatory?.wholesaleShare, 100);
    assert.equal(state?.regulatory?.wholesaleRunoff, 0);
    assert.equal(state?.regulatory?.hqlaHaircut, 0);
    assert.equal(sanitizeState({ regulatory: 'nope' })?.regulatory, undefined);
  });

  it('sanitizes the provisioning inputs of imported configs', () => {
    const state = sanitizeState({ config: { lgdRate: 999, writeOffLag: -3.5 } });
    assert.equal(state?.config?.lgdRate, 100);
    assert.equal(state?.config?.writeOffLag, 0);
    const hostile = sanitizeState({ config: { lgdRate: 'x', writeOffLag: 1e9 } });
    assert.equal(hostile?.config?.lgdRate, 100);
    assert.equal(hostile?.config?.writeOffLag, 600);
  });
});

describe('policy-rate import ranges', () => {
  it('preserves policy rates up to 100 while contract rates stay capped at 60', () => {
    const state = sanitizeState({
      config: {
        qardFeeRate: 80,
        murabahaRate: 90,
        interbankRate: 80,
        depositProfitRate: 100,
        opportunityRate: 75,
      },
    });
    assert.equal(state?.config?.qardFeeRate, 60);
    assert.equal(state?.config?.murabahaRate, 60);
    assert.equal(state?.config?.interbankRate, 80);
    assert.equal(state?.config?.depositProfitRate, 100);
    assert.equal(state?.config?.opportunityRate, 75);
  });
});

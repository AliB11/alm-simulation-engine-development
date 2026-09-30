import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { simulate } from './engine';
import { PRESETS } from './presets';
import { presetInput } from './testUtils';

/**
 * آزمون «اعداد طلایی» (Golden Numbers)
 *
 * سنجه‌های کلیدی سه الگوی نمونه با ورودی‌های پیش‌فرض، در سطح ریال
 * گرد (round) شده، فریز می‌شوند. هر تغییر در موتور که این اعداد را
 * جابه‌جا کند، یا یک باگ رگرسیونی است یا یک تغییر عمدی مدل که باید
 * آگاهانه و با به‌روزرسانی همین فایل انجام شود.
 */

const GOLDEN: Record<string, Record<string, number | null>> = {
  'sample-1': {
    totalDeposit: 50000000000,
    netDeposit: 45000000000,
    totalCommitment: 48420000000,
    maxHole: 36239000000,
    minCumMonth: 12,
    tippingPoint: 12,
    recoveryMonth: 30,
    deficitMonths: 18,
    endCum: 6721600000,
    leverage: 1.987111111,
    interbankCost: 5115159750,
    borrowers: 360,
    peakOutflow: 53800000000,
    totalProfitPaid: 0,
    totalIncomeInHorizon: 3261600000,
    netInterestIncome: 3261600000,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: -1853559750,
  },
  'sample-2': {
    totalDeposit: 50000000000,
    netDeposit: 45000000000,
    totalCommitment: 40212000000,
    maxHole: 28112960000,
    minCumMonth: 12,
    tippingPoint: 12,
    recoveryMonth: 24,
    deficitMonths: 12,
    endCum: 5781280000,
    leverage: 1.804711111,
    interbankCost: 3205266200,
    borrowers: 360,
    peakOutflow: 39190000000,
    totalProfitPaid: 0,
    totalIncomeInHorizon: 2429280000,
    netInterestIncome: 2429280000,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: -775986200,
  },
  'sample-3': {
    totalDeposit: 50000000000,
    netDeposit: 45000000000,
    totalCommitment: 30938940000,
    maxHole: 19737043879,
    minCumMonth: 12,
    tippingPoint: 9,
    recoveryMonth: 33,
    deficitMonths: 24,
    endCum: 11774172530,
    leverage: 1.598643111,
    interbankCost: 4065590855,
    borrowers: 360,
    peakOutflow: 13778975958,
    totalProfitPaid: 68725867,
    totalIncomeInHorizon: 9234303372,
    netInterestIncome: 9165577506,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: 5099986651,
  },
};

const MONEY_KEYS = [
  'totalDeposit',
  'netDeposit',
  'totalCommitment',
  'maxHole',
  'endCum',
  'interbankCost',
  'peakOutflow',
  'totalProfitPaid',
  'totalIncomeInHorizon',
  'netInterestIncome',
  'totalProvision',
  'totalWriteOff',
  'netMargin',
] as const;

describe('golden numbers for shipped presets', () => {
  for (const preset of PRESETS) {
    it(`freezes the KPI set of «${preset.name}»`, () => {
      const kpis = simulate(presetInput(preset.key), false).kpis;
      const expected = GOLDEN[preset.key];
      assert.ok(expected, `golden record missing for ${preset.key}`);

      for (const key of MONEY_KEYS) {
        assert.equal(Math.round(kpis[key]), expected[key], `${preset.key}.${key}`);
      }
      for (const key of ['minCumMonth', 'tippingPoint', 'recoveryMonth', 'deficitMonths'] as const) {
        assert.equal(kpis[key], expected[key], `${preset.key}.${key}`);
      }
      // شمار وام‌گیرندگان یک سرشمار است که از جمع سهم پله‌ها می‌آید؛ خطای
      // گردآوری شناور در رقم ۱۳م قابل قبول است، پس مقایسه گرد می‌شود.
      assert.equal(Math.round(kpis.borrowers), expected.borrowers, `${preset.key}.borrowers`);
      // اهرم یک نسبت است؛ با تلورانس ۱e-۹ مقایسه می‌شود
      assert.ok(Math.abs(kpis.leverage - Number(expected.leverage)) < 1e-9, `${preset.key}.leverage`);
    });
  }

  it('keeps the simulation deterministic across repeated runs', () => {
    for (const preset of PRESETS) {
      const input = presetInput(preset.key);
      const a = simulate(input, false).kpis;
      const b = simulate(input, false).kpis;
      assert.equal(a.maxHole, b.maxHole);
      assert.equal(a.netMargin, b.netMargin);
      assert.equal(a.endCum, b.endCum);
    }
  });

  it('does not mutate the input tiers while simulating', () => {
    const input = presetInput('sample-2');
    const before = JSON.stringify(input.tiers);
    simulate(input, true);
    assert.equal(JSON.stringify(input.tiers), before);
  });
});

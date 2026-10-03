import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { simulate } from './engine';
import { PRESETS } from './presets';
import { presetInput } from './testUtils';

/**
 * آزمون «اعداد طلایی» (Golden Numbers)
 *
 * سنجه‌های کلیدی دو الگوی نمونه با ورودی‌های پیش‌فرض، در سطح تومان
 * گرد (round) شده، فریز می‌شوند. هر تغییر در موتور که این اعداد را
 * جابه‌جا کند، یا یک باگ رگرسیونی است یا یک تغییر عمدی مدل که باید
 * آگاهانه و با به‌روزرسانی همین فایل انجام شود.
 */

const GOLDEN: Record<string, Record<string, number | null>> = {
  'sample-1': {
    totalDeposit: 50000000000,
    netDeposit: 45000000000,
    totalCommitment: 13054500000,
    maxHole: 5838125000,
    minCumMonth: 18,
    tippingPoint: 12,
    recoveryMonth: 30,
    deficitMonths: 18,
    endCum: 4497880000,
    leverage: 1.201211111111111,
    interbankCost: 1058023359,
    borrowers: 360,
    peakOutflow: 25140000000,
    totalProfitPaid: 0,
    totalIncomeInHorizon: 546480000,
    netInterestIncome: 546480000,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: -511543359,
  },
  'sample-3': {
    totalDeposit: 50000000000,
    netDeposit: 45000000000,
    totalCommitment: 26982000000,
    maxHole: 16970358386,
    minCumMonth: 12,
    tippingPoint: 6,
    recoveryMonth: 34,
    deficitMonths: 28,
    endCum: 10594780398,
    leverage: 1.5107111111111111,
    interbankCost: 4126193199,
    borrowers: 360,
    peakOutflow: 15003654167,
    totalProfitPaid: 61228333,
    totalIncomeInHorizon: 8365334632,
    netInterestIncome: 8304106298,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: 4177913099,
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
    const input = presetInput('sample-1');
    const before = JSON.stringify(input.tiers);
    simulate(input, true);
    assert.equal(JSON.stringify(input.tiers), before);
  });
});

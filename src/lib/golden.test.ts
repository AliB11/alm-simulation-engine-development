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
    totalCommitment: 26030000000,
    maxHole: 14103378711,
    minCumMonth: 18,
    tippingPoint: 15,
    recoveryMonth: 36,
    deficitMonths: 21,
    endCum: 4495840800,
    leverage: 1.489555555555553,
    interbankCost: 2314228608,
    borrowers: 360,
    peakOutflow: 5017777778,
    totalProfitPaid: 0,
    totalIncomeInHorizon: 1083605467,
    netInterestIncome: 1083605467,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: -1230623141,
  },
  /* نمونهٔ دوم (نگین فراپویا): ۷۴ حالتِ بازسازی‌شده از قاعدهٔ امتیاز محصول،
     با سود علی‌الحساب سپردهٔ ۰٫۰۱٪ و سقف فردی ۴۰۰ میلیون تومان. */
  'sample-3': {
    totalDeposit: 50000000000,
    netDeposit: 45000000000,
    totalCommitment: 27121621622,
    maxHole: 19249130889,
    minCumMonth: 12,
    tippingPoint: 10,
    recoveryMonth: 33,
    deficitMonths: 23,
    endCum: 10722914627,
    leverage: 1.5138138138138133,
    interbankCost: 4016071052,
    borrowers: 360,
    peakOutflow: 8013604673,
    totalProfitPaid: 6993806,
    totalIncomeInHorizon: 7742284866,
    netInterestIncome: 7735291060,
    totalProvision: 0,
    totalWriteOff: 0,
    netMargin: 3719220008,
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

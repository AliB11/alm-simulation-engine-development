import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configDiffs, KPI_ROWS, snapshotSlot, SLOT_META } from './scenarios';
import { fmtNumber, toFa } from './format';
import { simulate } from './engine';
import { presetInput } from './testUtils';

describe('scenario comparison helpers', () => {
  it('describes input differences in Persian digits and contract names', () => {
    const a = presetInput('sample-1');
    const b = presetInput('sample-3');
    const ka = simulate(a, false).kpis;
    const kb = simulate(b, false).kpis;
    const slotA = snapshotSlot('A', a, ka, 'پایه');
    const slotB = snapshotSlot('B', b, kb, 'جایگزین');
    const diffs = configDiffs(slotA, slotB);

    // مقادیر از خودِ ورودی گرفته می‌شوند تا تغییر نرخ سود سپردهٔ یک الگو این
    // آزمون را نشکند؛ آنچه اینجا واقعاً بررسی می‌شود قالب فارسی است.
    const depLine = diffs.find((d) => d.startsWith('سود سپرده:'));
    assert.ok(depLine, 'the deposit-rate difference must be listed');
    // همان قالبی که configDiffs استفاده می‌کند: fmtNumber(…, 1, true) بعد toFa
    const render = (v: number) => toFa(fmtNumber(v, 1, true));
    assert.ok(depLine.includes(render(a.config.depositProfitRate)), `diff must show the source rate: ${depLine}`);
    assert.ok(depLine.includes(render(b.config.depositProfitRate)), `diff must show the target rate: ${depLine}`);
    assert.ok(diffs.some((d) => d.includes('قرض‌الحسنه') && d.includes('مرابحه')));
    assert.ok(diffs.every((d) => !d.includes('qard') && !d.includes('murabaha')));
    assert.ok(diffs.every((d) => !/\d/.test(d)), 'diffs must not leak Latin digits');
    assert.equal(slotA.name, 'پایه');
    assert.ok(slotA.savedAt > 0);
    assert.equal(SLOT_META.A.label, 'سناریوی A');
  });

  it('falls back to an automatic Persian name and does not mutate the source input', () => {
    const input = presetInput('sample-1');
    const before = JSON.stringify(input);
    const slot = snapshotSlot('C', input, simulate(input, false).kpis);
    assert.ok(slot.name.startsWith('سناریوی C'));
    assert.equal(JSON.stringify(input), before);
    assert.notEqual(slot.tiers, input.tiers, 'the snapshot must be a copy');
    slot.tiers[0].alpha = 1;
    assert.notEqual(input.tiers[0].alpha, 1);
  });

  it('reports no diffs for an identical pair', () => {
    const input = presetInput('sample-1');
    const kpis = simulate(input, false).kpis;
    const a = snapshotSlot('A', input, kpis, 'یک');
    const b = snapshotSlot('B', input, kpis, 'دو');
    assert.deepEqual(configDiffs(a, b), []);
  });
});

describe('scenario diff coverage', () => {
  it('reports npl, liquidity, schedule and tier-pricing differences', () => {
    const a = presetInput('sample-1');
    const b = structuredClone(a);
    b.config.initialLiquidity = 1_000_000;
    b.config.minLoan = 10_000_000;
    b.config.releaseReserve = true;
    b.config.lgdRate = 50;
    b.config.writeOffLag = 3;
    b.config.opportunityRate = 30;
    b.behavior = { ...b.behavior, avgTicket: 50_000_000 };
    b.schedule = { ...b.schedule, mode: 'uniform', uniformMonths: 24 };
    b.tiers = b.tiers.map((t, i) =>
      i === 0 ? { ...t, minBalance: 9_000_000, rateOverride: 7 } : t,
    );
    const ka = simulate(a, false).kpis;
    const kb = simulate(b, false).kpis;
    const diffs = configDiffs(snapshotSlot('A', a, ka, 'الف'), snapshotSlot('B', b, kb, 'ب'));
    for (const label of [
      'نقدینگی اولیه',
      'حداقل مبلغ وام',
      'آزادسازی سپرده قانونی',
      'LGD',
      'مهلت سوخت',
      'هزینه فرصت',
      'میانگین سپرده',
      'زمان‌بندی ورود',
      'ماه‌های توزیع یکنواخت',
      'حداقل مانده',
      'نرخ اختصاصی',
    ]) {
      assert.ok(diffs.some((d) => d.includes(label)), `missing diff for ${label}: ${diffs.join(' | ')}`);
    }
    assert.ok(diffs.every((d) => !/\d/.test(d)), 'diffs must not leak Latin digits');
  });

  it('compares loan-loss provision and write-off across scenarios', () => {
    const keys = KPI_ROWS.map((r) => r.key);
    assert.ok(keys.includes('totalProvision'));
    assert.ok(keys.includes('totalWriteOff'));
  });

  it('flags custom-vintage composition changes', () => {
    const a = presetInput('sample-1');
    const b = structuredClone(a);
    b.schedule = {
      mode: 'custom',
      uniformMonths: 12,
      custom: [
        { id: 'x', month: 0, share: 70 },
        { id: 'y', month: 2, share: 30 },
      ],
    };
    const ka = simulate(a, false).kpis;
    const kb = simulate(b, false).kpis;
    const diffs = configDiffs(snapshotSlot('A', a, ka, 'الف'), snapshotSlot('B', b, kb, 'ب'));
    assert.ok(diffs.some((d) => d.includes('زمان‌بندی ورود')));
    assert.ok(diffs.some((d) => d.includes('ترکیب ویژه‌های سفارشی')));
  });
});

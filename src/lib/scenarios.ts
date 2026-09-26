/* ------------------------------------------------------------------ *
 *  SCENARIO SLOTS — مقایسهٔ سناریو A/B/C
 *
 *  سه جایگاه برای «عکس‌برداری» از وضعیت کامل طرح (پیکربندی، پله‌ها،
 *  رفتار و زمان‌بندی ورود منابع) همراه KPIهای لحظهٔ ذخیره. ذخیره‌ها در
 *  localStorage می‌مانند تا مقایسه پس از بستن مرورگر هم در دسترس باشد.
 * ------------------------------------------------------------------ */

import type { Behavior, DepositSchedule, GlobalConfig, SimInput, SimKpis, SimResult, Tier } from '../types';
import { simulate } from './engine';
import { fmtNumber, toFa } from './format';

export type SlotId = 'A' | 'B' | 'C';

export const SLOT_IDS: SlotId[] = ['A', 'B', 'C'];

export const SLOT_META: Record<SlotId, { label: string; color: string }> = {
  A: { label: 'سناریوی A', color: '#6366f1' },
  B: { label: 'سناریوی B', color: '#10b981' },
  C: { label: 'سناریوی C', color: '#f59e0b' },
};

export interface ScenarioSlot {
  name: string;
  savedAt: number;
  config: GlobalConfig;
  tiers: Tier[];
  behavior: Behavior;
  schedule: DepositSchedule;
  kpis: SimKpis;
}

export type ScenarioSlots = Record<SlotId, ScenarioSlot | null>;

export const EMPTY_SLOTS: ScenarioSlots = { A: null, B: null, C: null };

export function snapshotSlot(id: SlotId, input: SimInput, kpis: SimKpis, name?: string): ScenarioSlot {
  const stamp = new Date();
  const auto = `${SLOT_META[id].label} · ${stamp.toLocaleDateString('fa-IR')} ${stamp.toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
  return {
    name: name && name.trim() ? name.trim().slice(0, 60) : auto,
    savedAt: Date.now(),
    config: { ...input.config },
    tiers: input.tiers.map((t) => ({ ...t })),
    behavior: { ...input.behavior },
    schedule: {
      mode: input.schedule.mode,
      uniformMonths: input.schedule.uniformMonths,
      custom: (input.schedule.custom ?? []).map((c) => ({ ...c })),
    },
    kpis,
  };
}

export function slotInput(s: ScenarioSlot): SimInput {
  return { config: s.config, tiers: s.tiers, behavior: s.behavior, schedule: s.schedule };
}

/**
 * شبیه‌سازی مجدد یک جایگاه — سنجه‌ها همیشه با نسخهٔ جاری موتور
 * بازمحاسبه می‌شوند تا مقایسهٔ سناریوها پس از تغییر مدل کهنه نماند.
 */
export function simulateSlot(s: ScenarioSlot, withDetails = false): SimResult {
  return simulate(slotInput(s), withDetails);
}

/* --------------------------- سنجه‌های قابل مقایسه --------------------------- */

export type KpiKind = 'money' | 'ratio' | 'month' | 'count' | 'pct';

export interface KpiRowDef {
  key: keyof SimKpis;
  label: string;
  kind: KpiKind;
  /** سنجه‌هایی که کوچک‌تر بودنشان بهتر است */
  lowerIsBetter?: boolean;
}

export const KPI_ROWS: KpiRowDef[] = [
  { key: 'maxHole', label: 'حداکثر کسری نقدینگی', kind: 'money', lowerIsBetter: true },
  { key: 'endCum', label: 'تراز نقدینگی پایان افق', kind: 'money' },
  { key: 'netMargin', label: 'حاشیهٔ خالص بانک', kind: 'money' },
  { key: 'totalCommitment', label: 'کل تعهد اعطای وام', kind: 'money' },
  { key: 'netDeposit', label: 'منابع ورودی خالص', kind: 'money' },
  { key: 'interbankCost', label: 'هزینهٔ تأمین کسری', kind: 'money', lowerIsBetter: true },
  { key: 'leverage', label: 'اهرم خروج', kind: 'ratio', lowerIsBetter: true },
  { key: 'tippingPoint', label: 'نقطهٔ واژگونی', kind: 'month', lowerIsBetter: true },
  { key: 'recoveryMonth', label: 'ماه بازیابی', kind: 'month', lowerIsBetter: true },
  { key: 'deficitMonths', label: 'تعداد ماه‌های کسری', kind: 'count', lowerIsBetter: true },
  { key: 'peakOutflow', label: 'اوج خروج ماهانه', kind: 'money', lowerIsBetter: true },
  { key: 'borrowers', label: 'تعداد وام‌گیرندگان', kind: 'count' },
];

export function kpiValue(k: SimKpis, key: keyof SimKpis): number | null {
  const v = k[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** خلاصهٔ تفاوت‌های پیکربندی دو سناریو — برای توضیح اینکه چه چیزی عوض شده */
export function configDiffs(a: ScenarioSlot, b: ScenarioSlot): string[] {
  const out: string[] = [];
  const fmt = (v: number, digits: number) => (digits === 0 ? fmtNumber(Math.round(v)) : fmtNumber(v, digits, true));
  const num = (label: string, x: number, y: number, digits = 1) => {
    if (Math.abs(x - y) > 1e-9) out.push(`${label}: ${fmt(x, digits)} به ${fmt(y, digits)}`);
  };
  const contractName = (t: string) => (t === 'murabaha' ? 'مرابحه' : 'قرض‌الحسنه');
  num('افق', a.config.horizon, b.config.horizon, 0);
  num('سپرده قانونی', a.config.reserveRatio, b.config.reserveRatio);
  num('نرخ قرارداد', a.config.contractType === 'qard' ? a.config.qardFeeRate : a.config.murabahaRate, b.config.contractType === 'qard' ? b.config.qardFeeRate : b.config.murabahaRate);
  num('سقف وام', a.config.loanCap, b.config.loanCap, 0);
  num('نکول', a.config.defaultRate, b.config.defaultRate);
  num('بین‌بانکی', a.config.interbankRate, b.config.interbankRate);
  num('سود سپرده', a.config.depositProfitRate, b.config.depositProfitRate);
  num('کل منابع', a.behavior.totalDeposit, b.behavior.totalDeposit, 0);
  num('نرخ تقاضا', a.behavior.takeUpRate, b.behavior.takeUpRate);
  num('نرخ قبولی', a.behavior.approvalRate, b.behavior.approvalRate);
  num('خروج سپرده', a.behavior.runoffRate, b.behavior.runoffRate);
  num('انصراف', a.behavior.churnRate, b.behavior.churnRate);
  if (a.config.contractType !== b.config.contractType) {
    out.push(`نوع قرارداد: ${contractName(a.config.contractType)} به ${contractName(b.config.contractType)}`);
  }
  if (a.tiers.length !== b.tiers.length) out.push(`تعداد پله‌ها: ${toFa(a.tiers.length)} به ${toFa(b.tiers.length)}`);
  const maxTiers = Math.max(a.tiers.length, b.tiers.length);
  for (let i = 0; i < maxTiers; i++) {
    const x = a.tiers[i];
    const y = b.tiers[i];
    if (!x || !y) continue;
    num(`پله ${toFa(i + 1)} · انتظار`, x.tDep, y.tDep, 0);
    num(`پله ${toFa(i + 1)} · بازپرداخت`, x.tLoan, y.tLoan, 0);
    num(`پله ${toFa(i + 1)} · ضریب`, x.alpha, y.alpha, 2);
    num(`پله ${toFa(i + 1)} · سهم`, x.allocation, y.allocation, 1);
  }
  return out;
}

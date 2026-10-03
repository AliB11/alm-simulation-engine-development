/* ------------------------------------------------------------------ *
 *  REGULATORY & MATURITY METRICS — سنجه‌های مقرراتی‌مانند
 *
 *  پیاده‌سازی آموزشی و قابل تنظیم از سه سنجه:
 *   • LCR  — نسبت پوشش نقدینگی ماهانه: دارایی نقد تنزیل‌شده (مازاد تجمعی
 *            مثبت پس از haircut) تقسیم بر خروج همان ماه + خروج استرس‌شدهٔ
 *            سپرده با نرخ مؤثر ترکیبی خرد/کلان
 *   • NSFR — نسبت خالص تأمین مالی پایدار در ماه m: منابع پایدار (سپرده ×
 *            ضریب پایداری) تقسیم بر دارایی‌های نیازمند تأمین (وام × ضریب)
 *   • WAL  — میانگین وزنی عمر دارایی‌ها و تعهدات و «شکاف سررسید». سمت
 *            تعهدات روی همان خروجی نردبان (برداشت + سود پرداختی سپرده +
 *            ماندهٔ زنده در افق) وزن می‌شود تا با نمودار نردبان هم‌خوان باشد
 *
 *  همهٔ ضرایب، ورودی کاربرند و در کد ثابت نشده‌اند. این سنجه‌ها جایگزین
 *  محاسبات رسمی ناظر نیستند؛ برای مقایسهٔ طرح‌ها طراحی شده‌اند.
 * ------------------------------------------------------------------ */

import type { MonthRow } from '../types';
import { bounded, EPS, finite } from './engine';
import { bucketCountFor, bucketLabel, bucketSizeForRows } from './buckets';

export interface RegulatoryParams {
  /** درصد اضافی از ماندهٔ سپردهٔ خرد که در سناریوی استرس خارج فرض می‌شود (LCR) */
  stressRunoff: number;
  /** ضریب پایداری منابع سپرده‌ای (ASF) — درصد */
  stableWeight: number;
  /** ضریب نیاز به تأمین پایدار برای دارایی وام (RSF) — درصد */
  loanWeight: number;
  /** سهم سپرده‌های کلان/شرکتی از ماندهٔ سپرده (درصد) — صفر یعنی همهٔ منابع خرد */
  wholesaleShare: number;
  /** درصد خروج استرس سپرده‌های کلان/شرکتی در سناریوی استرس (LCR) */
  wholesaleRunoff: number;
  /** تنزیل (haircut) دارایی نقد در محاسبهٔ LCR (درصد) */
  hqlaHaircut: number;
}

export const DEFAULT_REGULATORY: RegulatoryParams = {
  stressRunoff: 5,
  stableWeight: 90,
  loanWeight: 85,
  wholesaleShare: 0,
  wholesaleRunoff: 25,
  hqlaHaircut: 0,
};

export interface LcrPoint {
  month: number;
  /** نسبت به درصد؛ null یعنی ماه بدون خروج (پوشش نامحدود) */
  lcr: number | null;
  /** دارایی نقد پس از تنزیل */
  hqla: number;
  /** خروجی ماه + خروج استرس‌شده با نرخ مؤثر خرد/کلان */
  outflow: number;
}

export interface LadderRow {
  month: number;
  /** ورودی اصل سرمایه از دارایی وام (پس از کسر نکول) */
  inflow: number;
  /** برداشت اصل سپرده‌ها در این ماه */
  withdrawal: number;
  /** سود پرداختی به سپرده‌گذاران در این ماه */
  profit: number;
  /** خروجی کل سمت تعهدات = برداشت + سود */
  outflow: number;
  net: number;
  cumNet: number;
}

export interface LadderBucket {
  label: string;
  from: number;
  to: number;
  inflow: number;
  withdrawal: number;
  profit: number;
  outflow: number;
  net: number;
  cumNet: number;
}

export interface Regulatory {
  lcr: LcrPoint[];
  minLcr: number | null;
  minLcrMonth: number | null;
  monthsBelow100: number;
  /** نرخ مؤثر خروج استرس سپرده (ترکیب خرد/کلان) — درصد */
  effStressRunoff: number;
  nsfr: number | null;
  nsfrMonth: number;
  asf: number;
  rsf: number;
  /** میانگین وزنی عمر دارایی‌ها بر پایهٔ بازگشت اصل سرمایه */
  walAssets: number | null;
  /** میانگین وزنی عمر تعهدات بر پایهٔ خروجی سمت تعهد (برداشت + سود سپرده + ماندهٔ زندهٔ افق) */
  walLiabilities: number | null;
  maturityGap: number | null;
  recoveryRate: number | null;
  depositSurvival: number;
  ladder: LadderRow[];
  buckets: LadderBucket[];
  bucketSize: number;
}

/** ورودی اصل سرمایه در ماه t — پولی که از دارایی وام برمی‌گردد */
function assetInflow(row: MonthRow): number {
  return Math.max(0, finite(row.principalIn, 0));
}

export function computeRegulatory(rows: MonthRow[], params: RegulatoryParams): Regulatory {
  const H = rows.length;
  const stressRunoff = bounded(params.stressRunoff, 0, 100, DEFAULT_REGULATORY.stressRunoff);
  const stableWeight = bounded(params.stableWeight, 0, 100, DEFAULT_REGULATORY.stableWeight);
  const loanWeight = bounded(params.loanWeight, 0, 100, DEFAULT_REGULATORY.loanWeight);
  const wholesaleShare = bounded(params.wholesaleShare, 0, 100, DEFAULT_REGULATORY.wholesaleShare);
  const wholesaleRunoff = bounded(params.wholesaleRunoff, 0, 100, DEFAULT_REGULATORY.wholesaleRunoff);
  const hqlaHaircut = bounded(params.hqlaHaircut, 0, 100, DEFAULT_REGULATORY.hqlaHaircut);

  /* نرخ مؤثر خروج استرس: میانگین وزنی نرخ خرد و کلان با سهم سپردهٔ کلان */
  const effStressRunoff = ((100 - wholesaleShare) * stressRunoff + wholesaleShare * wholesaleRunoff) / 100;

  /* ------------------------------- LCR ------------------------------- */
  const lcr: LcrPoint[] = rows.map((row) => {
    const hqla = (Math.max(0, finite(row.cum, 0)) * (100 - hqlaHaircut)) / 100;
    const stress = (finite(row.depositBalance, 0) * effStressRunoff) / 100;
    const outflow = Math.max(0, finite(row.outflow, 0)) + stress;
    return {
      month: row.t,
      hqla,
      outflow,
      lcr: outflow > EPS ? (hqla / outflow) * 100 : null,
    };
  });
  const measured = lcr.filter((p) => p.lcr !== null) as { month: number; lcr: number }[];
  let minLcr: number | null = null;
  let minLcrMonth: number | null = null;
  for (const p of measured) {
    if (minLcr === null || p.lcr < minLcr) {
      minLcr = p.lcr;
      minLcrMonth = p.month;
    }
  }
  const monthsBelow100 = measured.filter((p) => p.lcr < 100).length;

  /* ------------------------------- NSFR ------------------------------ */
  const lastMonth = H ? rows[H - 1].t : 0;
  const nsfrMonth = lastMonth >= 12 ? 12 : lastMonth;
  const nsfrRow = rows.find((r) => r.t === nsfrMonth) ?? rows[rows.length - 1];
  const asf = nsfrRow ? (finite(nsfrRow.depositBalance, 0) * stableWeight) / 100 : 0;
  const rsf = nsfrRow ? (finite(nsfrRow.loanBook, 0) * loanWeight) / 100 : 0;
  const nsfr = rsf > EPS ? (asf / rsf) * 100 : null;

  /* ------------------------------- WAL ------------------------------- */
  let inflowWeighted = 0;
  let inflowTotal = 0;
  let outflowWeighted = 0;
  let outflowTotal = 0;
  const ladder: LadderRow[] = [];
  let cumNet = 0;
  let disbursedTotal = 0;
  let returnedTotal = 0;

  for (const row of rows) {
    const inflow = assetInflow(row);
    const withdrawal = Math.max(0, finite(row.withdrawalOut, 0));
    const profit = Math.max(0, finite(row.profitPaid, 0));
    const outflow = withdrawal + profit;
    cumNet += inflow - outflow;
    ladder.push({ month: row.t, inflow, withdrawal, profit, outflow, net: inflow - outflow, cumNet });
    inflowWeighted += row.t * inflow;
    inflowTotal += inflow;
    returnedTotal += inflow;
    disbursedTotal += finite(row.loanOut, 0);
    // WAL تعهدات روی همان «خروجی سمت تعهد» نردبان وزن می‌شود (برداشت + سود
    // پرداختی). اگر سود سپرده از این میانگین کنار گذاشته شود، عمر تعهدات و در
    // نتیجه شکاف سررسید با نمودار نردبانی که درست بالای همین عدد رسم می‌شود
    // ناسازگار می‌شود — در طرح‌های دارای سود سپرده (نمونهٔ دوم) این اختلاف
    // تقریباً یک ماه است.
    outflowWeighted += row.t * outflow;
    outflowTotal += outflow;
  }

  // ماندهٔ سپرده‌ای که تا افق زنده مانده، به‌عنوان تعهدی با سررسید باز در آخرین ماه لحاظ می‌شود
  const surviving = H ? Math.max(0, finite(rows[H - 1].depositBalance, 0)) : 0;
  outflowWeighted += lastMonth * surviving;
  outflowTotal += surviving;

  const walAssets = inflowTotal > EPS ? inflowWeighted / inflowTotal : null;
  const walLiabilities = outflowTotal > EPS ? outflowWeighted / outflowTotal : null;
  const maturityGap = walAssets !== null && walLiabilities !== null ? walAssets - walLiabilities : null;
  const recoveryRate = disbursedTotal > EPS ? returnedTotal / disbursedTotal : null;

  /* ----------------------------- سطل‌بندی ---------------------------- */
  // اندازهٔ سطل از «افق» (شمارهٔ آخرین ماه) گرفته می‌شود، نه از تعداد ردیف‌ها.
  // ردیف‌ها از ماه صفر شروع می‌شوند، پس H = horizon + 1 است و استفاده از آن
  // مرزهای جدول را یک ماه جابه‌جا می‌کرد (مثلاً افق ۶۰ ماهه سطل ۶ ماهه
  // می‌گرفت در حالی که قاعدهٔ مستند سطل ۳ ماهه است).
  const size = bucketSizeForRows(rows);
  const buckets: LadderBucket[] = [];
  const count = bucketCountFor(H, size);
  let bucketCum = 0;
  for (let i = 0; i < count; i++) {
    // سطل‌ها روی «اندیس ردیف» بریده می‌شوند و برچسبشان ماه واقعی ردیف‌هاست
    // (شمارهٔ ماه‌های موتور از صفر آغاز می‌شود).
    const slice = ladder.slice(i * size, (i + 1) * size);
    if (!slice.length) continue;
    const from = slice[0].month;
    const to = slice[slice.length - 1].month;
    const inflow = slice.reduce((s, r) => s + r.inflow, 0);
    const withdrawal = slice.reduce((s, r) => s + r.withdrawal, 0);
    const profit = slice.reduce((s, r) => s + r.profit, 0);
    const outflow = withdrawal + profit;
    bucketCum += inflow - outflow;
    buckets.push({
      label: bucketLabel(from, to),
      from,
      to,
      inflow,
      withdrawal,
      profit,
      outflow,
      net: inflow - outflow,
      cumNet: bucketCum,
    });
  }

  return {
    lcr,
    minLcr,
    minLcrMonth,
    monthsBelow100,
    effStressRunoff,
    nsfr,
    nsfrMonth,
    asf,
    rsf,
    walAssets,
    walLiabilities,
    maturityGap,
    recoveryRate,
    depositSurvival: surviving,
    ladder,
    buckets,
    bucketSize: size,
  };
}

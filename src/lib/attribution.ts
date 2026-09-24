/* ------------------------------------------------------------------ *
 *  TIER ATTRIBUTION — انتساب ریسک نقدینگی به پله‌ها
 *
 *  پرسش: «کدام پله حفرهٔ نقدینگی را می‌سازد؟»
 *
 *  روش تحلیلی (بدون شبیه‌سازی مجدد): اگر پلهٔ k به‌طور کامل از طرح حذف
 *  شود — یعنی نه منابعش وارد شود، نه وامش پرداخت شود و نه اقساط و
 *  برداشت‌هایش — آنگاه نقدینگی تجمعی جدید برابر است با:
 *
 *      cum′_t = cum_t − Σ_{j≤t} ncf_{k,j}
 *
 *  که ncf_{k,j} جمع رویدادهای منتسب به آن پله در ماه j است. سود پرداختی
 *  به سپرده‌گذاران یک جریان سطح‌پرتفوی است و بر پایهٔ ماندهٔ هر پله
 *  (ورودی منهای برداشت) به پله‌ها نسبت داده می‌شود.
 *
 *  این انتساب تقریبی نیست: دقیقاً همان جریان‌هایی را برمی‌دارد که موتور
 *  در ماتریس ثبت کرده است. تنها تقریب، توزیع سود سپرده بر پایهٔ ماندهٔ
 *  رویدادمحور هر پله است.
 * ------------------------------------------------------------------ */

import type { MonthRow } from '../types';
import { EPS, finite } from './engine';
import { EVENT_META } from './eventMeta';

export interface TierAttribution {
  tierId: string;
  tierIndex: number;
  name: string;
  color: string;
  deposit: number;
  withdrawal: number;
  loan: number;
  pmt: number;
  profit: number;
  ncf: number;
  /** مسیر نقدینگی تجمعی پس از حذف این پله */
  cumWithout: number[];
  minCumWithout: number;
  minCumMonthWithout: number;
  maxHoleWithout: number;
  tippingWithout: number | null;
  endCumWithout: number;
  /** تغییر حفره نسبت به طرح پایه (منفی = حذف این پله وضعیت را بهتر می‌کند) */
  holeDelta: number;
  /** ماه‌هایی که با حذف پله از واژگونی نجات پیدا می‌کند (مثبت = بهبود) */
  tippingDelta: number | null;
}

export interface AttributionResult {
  base: { minCum: number; minCumMonth: number; maxHole: number; tipping: number | null; endCum: number };
  tiers: TierAttribution[];
  /** سود سپرده‌ای که به هیچ پله‌ای منتسب نشد (سپردهٔ بدون تخصیص) */
  unattributedProfit: number;
  /** ماتریس خروجی پله × سطل زمانی برای نقشهٔ حرارتی نردبان سررسید */
  heat: {
    bucketLabels: string[];
    bucketSize: number;
    /** خروجی هر پله در هر سطل (برداشت + سود منتسب) */
    cells: number[][];
    /** ورودی اصل سرمایه در هر سطل */
    inflow: number[];
  };
}

function tippingOf(path: number[], months: number[]): number | null {
  for (let i = 0; i < path.length; i++) {
    if (path[i] < -EPS) return months[i];
  }
  return null;
}

export function bucketSizeFor(horizon: number): number {
  const H = Math.round(finite(horizon, 60));
  if (H <= 24) return 1;
  if (H <= 60) return 3;
  if (H <= 180) return 6;
  return 12;
}

export function tierAttribution(rows: MonthRow[], colorOf: (index: number) => string): AttributionResult {
  const H = rows.length;
  const months = rows.map((r) => r.t);

  // شناسایی پله‌های واقعی از رویدادها (tierIndex ≥ ۰)
  const order: { tierId: string; tierIndex: number; name: string }[] = [];
  const indexById = new Map<string, number>();
  for (const row of rows) {
    for (const e of row.events) {
      if (e.tierIndex < 0 || indexById.has(e.tierId)) continue;
      indexById.set(e.tierId, order.length);
      order.push({ tierId: e.tierId, tierIndex: e.tierIndex, name: e.tierName });
    }
  }
  order.sort((a, b) => a.tierIndex - b.tierIndex);
  const n = order.length;
  const slot = new Map<string, number>(order.map((o, i) => [o.tierId, i]));

  // ماتریس جریان خالص هر پله در هر ماه + ماندهٔ سپردهٔ هر پله
  const ncfMatrix: Float64Array[] = Array.from({ length: n }, () => new Float64Array(H));
  const balMatrix: Float64Array[] = Array.from({ length: n }, () => new Float64Array(H));
  const totals = Array.from({ length: n }, () => ({
    deposit: 0,
    withdrawal: 0,
    loan: 0,
    pmt: 0,
    profit: 0,
  }));
  let unattributedProfit = 0;

  for (let t = 0; t < H; t++) {
    const row = rows[t];
    for (let i = 0; i < n; i++) balMatrix[i][t] = t > 0 ? balMatrix[i][t - 1] : 0;

    for (const e of row.events) {
      const i = slot.get(e.tierId);
      const amount = Math.max(0, finite(e.amount, 0));
      // سود سپرده یک رویداد سطح‌پرتفوی است (tierIndex = −۱) و در گام بعد
      // بر پایهٔ ماندهٔ هر پله توزیع می‌شود؛ اینجا شمرده نمی‌شود تا دوباره‌شماري رخ ندهد.
      if (e.type === 'profit') continue;
      if (i === undefined) continue;
      const tot = totals[i];
      switch (e.type) {
        case 'deposit':
          tot.deposit += amount;
          balMatrix[i][t] += amount;
          break;
        case 'withdrawal':
          tot.withdrawal += amount;
          balMatrix[i][t] -= amount;
          break;
        case 'loan':
          tot.loan += amount;
          break;
        case 'pmt':
          tot.pmt += amount;
          break;
        default:
          break;
      }
      ncfMatrix[i][t] += EVENT_META[e.type].sign * amount;
    }
  }

  // نسبت‌دادن سود سطح‌پرتفوی به پله‌ها بر پایهٔ ماندهٔ هر پله
  const profitShares: Float64Array[] = Array.from({ length: n }, () => new Float64Array(H));
  for (let t = 0; t < H; t++) {
    const profitPaid = Math.max(0, finite(rows[t].profitPaid, 0));
    const balance = finite(rows[t].depositBalance, 0);
    if (profitPaid <= EPS || !(balance > 0)) {
      unattributedProfit += profitPaid > EPS ? profitPaid : 0;
      continue;
    }
    let distributed = 0;
    for (let i = 0; i < n; i++) {
      const bal = Math.max(0, balMatrix[i][t]);
      const share = Math.min(1, bal / balance);
      const amount = profitPaid * share;
      if (amount <= EPS) continue;
      profitShares[i][t] = amount;
      totals[i].profit += amount;
      ncfMatrix[i][t] -= amount;
      distributed += amount;
    }
    const rest = profitPaid - distributed;
    if (rest > EPS) unattributedProfit += rest;
  }

  // ساخت مسیر «بدون پله» برای هر پله
  const tiers: TierAttribution[] = [];
  let baseMinCum = Infinity;
  let baseMinMonth = 0;
  let baseTipping: number | null = null;
  for (let t = 0; t < H; t++) {
    const cum = finite(rows[t].cum, 0);
    if (cum < baseMinCum - EPS) {
      baseMinCum = cum;
      baseMinMonth = rows[t].t;
    }
    if (baseTipping === null && cum < -EPS) baseTipping = rows[t].t;
  }
  if (!Number.isFinite(baseMinCum)) baseMinCum = 0;
  const baseMaxHole = baseMinCum < -EPS ? -baseMinCum : 0;
  const baseEndCum = H ? finite(rows[H - 1].cum, 0) : 0;

  for (let i = 0; i < n; i++) {
    const path: number[] = [];
    let removed = 0;
    let minCum = Infinity;
    let minMonth = 0;
    for (let t = 0; t < H; t++) {
      removed += ncfMatrix[i][t];
      const c = finite(rows[t].cum, 0) - removed;
      path.push(c);
      if (c < minCum - EPS) {
        minCum = c;
        minMonth = months[t];
      }
    }
    if (!Number.isFinite(minCum)) minCum = 0;
    const maxHoleWithout = minCum < -EPS ? -minCum : 0;
    const tippingWithout = tippingOf(path, months);
    tiers.push({
      tierId: order[i].tierId,
      tierIndex: order[i].tierIndex,
      name: order[i].name,
      color: colorOf(order[i].tierIndex),
      deposit: totals[i].deposit,
      withdrawal: totals[i].withdrawal,
      loan: totals[i].loan,
      pmt: totals[i].pmt,
      profit: totals[i].profit,
      ncf: path.length ? finite(rows[H - 1].cum, 0) - path[path.length - 1] : 0,
      cumWithout: path,
      minCumWithout: minCum,
      minCumMonthWithout: minMonth,
      maxHoleWithout,
      tippingWithout,
      endCumWithout: path.length ? path[path.length - 1] : 0,
      holeDelta: maxHoleWithout - baseMaxHole,
      tippingDelta:
        baseTipping !== null && tippingWithout !== null
          ? tippingWithout - baseTipping
          : baseTipping !== null && tippingWithout === null
            ? Infinity
            : null,
    });
  }

  /* ------------------------- ماتریس حرارتی نردبان ------------------------- */
  const size = bucketSizeFor(H);
  const bucketCount = Math.ceil(H / size);
  const bucketLabels: string[] = [];
  const cells: number[][] = Array.from({ length: n }, () => new Array<number>(bucketCount).fill(0));
  const inflow: number[] = new Array<number>(bucketCount).fill(0);

  for (let b = 0; b < bucketCount; b++) {
    const start = b * size;
    const end = Math.min(H, (b + 1) * size);
    const fromMonth = H ? rows[start].t : 0;
    const toMonth = H ? rows[end - 1].t : 0;
    bucketLabels.push(size === 1 ? `${fromMonth}` : `${fromMonth}–${toMonth}`);
    for (let t = start; t < end; t++) {
      const row = rows[t];
      inflow[b] += Math.max(0, finite(row.principalIn, 0));
      for (const e of row.events) {
        if (e.tierIndex < 0) continue;
        const i = slot.get(e.tierId);
        if (i === undefined) continue;
        if (e.type === 'withdrawal') cells[i][b] += Math.max(0, finite(e.amount, 0));
      }
      const profitPaid = Math.max(0, finite(row.profitPaid, 0));
      if (profitPaid > EPS) {
        for (let i = 0; i < n; i++) cells[i][b] += profitShares[i][t];
      }
    }
  }

  return {
    base: {
      minCum: baseMinCum,
      minCumMonth: baseMinMonth,
      maxHole: baseMaxHole,
      tipping: baseTipping,
      endCum: baseEndCum,
    },
    tiers,
    unattributedProfit,
    heat: { bucketLabels, bucketSize: size, cells, inflow },
  };
}

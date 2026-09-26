/* ------------------------------------------------------------------ *
 *  TORNADO — حساسیت تک‌متغیره (One-at-a-time)
 *
 *  ماتریس دوبعدی حساسیت ترکیب دو متغیر را نشان می‌دهد، اما پاسخ سؤال
 *  «کدام اهرم ریسک بیشترین اثر را دارد؟» را نمی‌دهد. اینجا هر متغیر ریسک
 *  به‌تنهایی و در دو کران پایین/بالای همان شبکهٔ آزمون بحران تکان داده
 *  می‌شود و بقیهٔ ورودی‌ها ثابت می‌مانند:
 *
 *      swing_k = | metric(کران بالا) − metric(کران پایین) |
 *
 *  میله‌ها بر پایهٔ swing نزولی مرتب می‌شوند؛ شکل حاصل همان نمودار
 *  گردبادی است که در گزارش‌های ریسک برای رتبه‌بندی محرک‌ها استفاده می‌شود.
 *  کران‌ها از `SENS_VARS` گرفته می‌شوند تا با ماتریس دوبعدی هم‌خوان باشند
 *  و هیچ عدد جدیدی به مدل وارد نشود.
 * ------------------------------------------------------------------ */

import type { SimInput, SimKpis } from '../types';
import { applySensitivity, SENS_VARS, simulate, type SensMetric, type SensVar } from './engine';
import { EPS, finite } from './engine';

/** سقف نمایشی اهرم خروج — یک خانهٔ ∞ نباید مقیاس همهٔ میله‌ها را بخورد */
export const LEVERAGE_DISPLAY_CAP = 100;

export interface TornadoBar {
  key: SensVar;
  label: string;
  symbol: string;
  /** مقدار جاری متغیر در طراحی فعال */
  current: number;
  low: number;
  high: number;
  /** مقدار سنجه در طراحی فعال */
  base: number;
  lowValue: number;
  highValue: number;
  lowDelta: number;
  highDelta: number;
  /** دامنهٔ نوسان — معیار رتبه‌بندی اهمیت محرک */
  swing: number;
}

export interface TornadoResult {
  metric: SensMetric;
  /** سنجه در طراحی فعال؛ میله‌ها نسبت به همین مقدار سنجیده می‌شوند */
  base: number;
  bars: TornadoBar[];
  evaluations: number;
}

/**
 * مقدار عددی یک سنجه برای نمودار گردبادی.
 * «واژگونی ندارد» به‌جای null با «یک ماه پس از افق» جایگزین می‌شود تا امن‌ترین
 * حالت، بزرگ‌ترین عدد باشد و طول میله معنا داشته باشد.
 */
export function tornadoMetric(k: SimKpis, metric: SensMetric, horizon: number): number {
  const H = Math.max(0, Math.round(finite(horizon, 60)));
  switch (metric) {
    case 'maxHole':
      return finite(k.maxHole, 0);
    case 'tipping':
      return k.tippingPoint === null ? H + 1 : finite(k.tippingPoint, H + 1);
    case 'endCum':
      return finite(k.endCum, 0);
    case 'leverage':
      return Number.isFinite(k.leverage)
        ? Math.min(LEVERAGE_DISPLAY_CAP, Math.max(0, finite(k.leverage, 0)))
        : LEVERAGE_DISPLAY_CAP;
    case 'margin':
      return finite(k.netMargin, 0);
  }
}

/** آیا این سنجه «بزرگ‌تر بهتر» است یا «کوچک‌تر بهتر» — برای رنگ‌آمیزی میله‌ها */
export function higherIsBetter(metric: SensMetric): boolean {
  return metric === 'endCum' || metric === 'margin' || metric === 'tipping';
}

export function runTornado(input: SimInput, metric: SensMetric): TornadoResult {
  const H = Math.round(finite(input.config.horizon, 60));
  const base = tornadoMetric(simulate(input, false).kpis, metric, H);

  const bars: TornadoBar[] = [];
  let evaluations = 1;

  for (const def of SENS_VARS) {
    const grid = def.values(input).filter((v) => Number.isFinite(v));
    if (!grid.length) continue;
    const low = Math.min(...grid);
    const high = Math.max(...grid);
    const current = finite(def.current(input), low);
    const lowValue = tornadoMetric(simulate(applySensitivity(input, def.key, low), false).kpis, metric, H);
    const highValue = tornadoMetric(simulate(applySensitivity(input, def.key, high), false).kpis, metric, H);
    evaluations += 2;
    bars.push({
      key: def.key,
      label: def.label,
      symbol: def.symbol,
      current,
      low,
      high,
      base,
      lowValue,
      highValue,
      lowDelta: lowValue - base,
      highDelta: highValue - base,
      swing: Math.max(lowValue, highValue, base) - Math.min(lowValue, highValue, base),
    });
  }

  bars.sort((a, b) => b.swing - a.swing || a.label.localeCompare(b.label, 'fa'));

  return { metric, base, bars, evaluations };
}

/** محرک‌هایی که عملاً بر این سنجه اثر ندارند — برای کم‌رنگ نشان دادن در رابط */
export function isNegligible(bar: TornadoBar, base: number): boolean {
  const scale = Math.max(1, Math.abs(base));
  return bar.swing <= EPS * scale * 1e6 || bar.swing / scale < 1e-6;
}

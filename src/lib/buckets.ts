/* ------------------------------------------------------------------ *
 *  TIME BUCKETING — اندازهٔ سطل‌های زمانی مشترک
 *
 *  نردبان سررسید (regulatory) و نقشهٔ حرارتی انتساب پله‌ها (attribution)
 *  هر دو باید روی همان سطل‌ها بریده شوند، وگرنه دو جدول کنار هم در یک
 *  کارت، افق یکسان را با دانه‌بندی متفاوت نشان می‌دهند. این ماژول تنها
 *  منبع حقیقت برای آن قاعده است.
 *
 *  توجه: ورودی «افق» است (شمارهٔ آخرین ماه، یعنی `rows.length − ۱`)،
 *  نه تعداد ردیف‌ها. ردیف‌های موتور از ماه صفر شروع می‌شوند، پس
 *  `rows.length === horizon + 1` است؛ استفاده از تعداد ردیف‌ها مرزهای
 *  جدول را یک ماه جابه‌جا می‌کند.
 * ------------------------------------------------------------------ */

import { finite } from './engine';

/** افق پیش‌فرض — فقط برای ورودی نامعتبر */
export const DEFAULT_HORIZON = 60;

/** اندازهٔ سطل (ماه) برای یک افق، به‌گونه‌ای که جدول خوانا بماند */
export function bucketSizeFor(horizon: number): number {
  const H = Math.round(finite(horizon, DEFAULT_HORIZON));
  if (H <= 24) return 1;
  if (H <= 60) return 3;
  if (H <= 180) return 6;
  return 12;
}

/** شمارهٔ آخرین ماه یک ماتریس جریان نقد (افق واقعی آن) */
export function horizonOf(rows: { t: number }[]): number {
  if (!rows.length) return 0;
  const last = finite(rows[rows.length - 1].t, 0);
  return Math.max(0, Math.round(last));
}

/** اندازهٔ سطل مناسب برای یک ماتریس جریان نقد */
export function bucketSizeForRows(rows: { t: number }[]): number {
  return bucketSizeFor(horizonOf(rows));
}

/** تعداد سطل لازم برای پوشش دقیق همهٔ ردیف‌ها */
export function bucketCountFor(rowCount: number, size: number): number {
  const n = Math.round(finite(rowCount, 0));
  const s = Math.max(1, Math.round(finite(size, 1)));
  return n > 0 ? Math.ceil(n / s) : 0;
}

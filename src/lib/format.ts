/* ------------------------------------------------------------------ *
 *  Persian number formatting utilities
 *  - ارقام فارسی + جداکننده سه‌رقمی (۱,۰۰۰,۰۰۰)
 *  - اعداد منفی با Unicode Isolate برای نمایش صحیح در متن راست‌چین
 * ------------------------------------------------------------------ */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const LRI = '\u2066';
const PDI = '\u2069';

export function toFa(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function toEn(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** قالب خام (بدون ایزوله دوجهته) — مناسب فیلدهای ورودی چپ‌چین و محورهای نمودار */
export function fmtRaw(n: number, decimals = 0, fixed = false): string {
  if (!Number.isFinite(n)) return '—';
  const threshold = decimals > 0 ? 0.5 * Math.pow(10, -decimals) : 0.5;
  const neg = n < 0 && Math.abs(n) >= threshold;
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: fixed ? decimals : 0,
    maximumFractionDigits: decimals,
  });
  return (neg ? '-' : '') + toFa(body).replace('.', '٫');
}

/** قالب نمایشی امن برای متن راست‌چین */
export function fmtNumber(n: number, decimals = 0, fixed = false): string {
  const s = fmtRaw(n, decimals, fixed);
  return s.startsWith('-') ? `${LRI}${s}${PDI}` : s;
}

export function fmtPct(n: number, decimals = 1, fixed = false): string {
  if (!Number.isFinite(n)) return '—';
  const s = `${fmtRaw(n, decimals, fixed)}٪`;
  return s.startsWith('-') ? `${LRI}${s}${PDI}` : s;
}

/**
 * قالب ضریب/نسبت (مانند اهرم خروج) که مخرجش می‌تواند صفر شود.
 * بی‌نهایت به‌صورت «∞» و مقدار نامعریف به‌صورت «—» نمایش داده می‌شود.
 */
export function fmtRatio(v: number, decimals = 2): string {
  if (Number.isNaN(v)) return '—';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  return fmtNumber(v, decimals, true);
}

/** نمایش فشرده با واحد فارسی (میلیون/میلیارد/هزار میلیارد) */
export function fmtCompact(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return `${fmtNumber(n / 1e12, digits)} هزار میلیارد`;
  if (a >= 1e9) return `${fmtNumber(n / 1e9, digits)} میلیارد`;
  if (a >= 1e6) return `${fmtNumber(n / 1e6, Math.min(digits, 1))} میلیون`;
  if (a >= 1e4) return `${fmtNumber(n / 1e3, 0)} هزار`;
  return fmtNumber(n, 0);
}

/** تجزیه ورودی کاربر (ارقام فارسی/عربی/لاتین، جداکننده، ممیز فارسی) */
export function parseNumber(s: string): number | null {
  const cleaned = toEn(s)
    .replace(/[\u2066-\u2069\u200e\u200f\s,٬]/g, '')
    .replace(/٫/g, '.')
    .replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** انتخاب واحد مناسب محور نمودار */
export function axisUnit(maxAbs: number): { div: number; label: string } {
  if (maxAbs >= 1e12) return { div: 1e12, label: 'هزار میلیارد' };
  if (maxAbs >= 1e9) return { div: 1e9, label: 'میلیارد' };
  if (maxAbs >= 1e6) return { div: 1e6, label: 'میلیون' };
  if (maxAbs >= 1e3) return { div: 1e3, label: 'هزار' };
  return { div: 1, label: '' };
}

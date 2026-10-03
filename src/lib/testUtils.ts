import type { SimInput } from '../types';
import { DEFAULT_BEHAVIOR, DEFAULT_CONFIG, DEFAULT_SCHEDULE, PRESETS } from './presets';

/**
 * ابزار مشترک آزمون‌ها.
 *
 * شناسهٔ پله‌ها در پیش‌تنظیم‌ها با `uid()` تصادفی ساخته می‌شود؛ برای
 * آزمون‌های قطعی و بازتولیدپذیر (به‌ویژه اعداد طلایی) شناسه‌های پایدار
 * `${key}-${i}` جایگزین می‌شوند. این فایل با الگوی `*.test.ts` مطابقت
 * ندارد، پس به‌عنوان آزمون اجرا نمی‌شود.
 */
export function presetInput(key: string): SimInput {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0];
  const tiers = p.tiers.map((t, i) => ({ ...t, id: `${key}-${i}` }));
  const config = {
    ...DEFAULT_CONFIG,
    contractType: p.contractType,
    ...(p.contractType === 'qard' ? { qardFeeRate: p.rate } : { murabahaRate: p.rate }),
    loanCap: p.loanCap,
    minLoan: p.minLoan ?? 0,
    depositProfitRate: p.depositProfitRate,
  };
  return { config, tiers, behavior: DEFAULT_BEHAVIOR, schedule: DEFAULT_SCHEDULE };
}

export const near = (a: number, b: number, tol = 1e-9): boolean =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

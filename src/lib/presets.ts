import type { Behavior, ContractType, DepositSchedule, GlobalConfig, Tier } from '../types';
import { toFa } from './format';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const TIER_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#f97316',
];

export const tierColor = (i: number) => TIER_COLORS[((i % TIER_COLORS.length) + TIER_COLORS.length) % TIER_COLORS.length];

const PERSIAN_ORDINALS = [
  'اول',
  'دوم',
  'سوم',
  'چهارم',
  'پنجم',
  'ششم',
  'هفتم',
  'هشتم',
  'نهم',
  'دهم',
  'یازدهم',
  'دوازدهم',
  'سیزدهم',
  'چهاردهم',
  'پانزدهم',
  'شانزدهم',
  'هفدهم',
  'هجدهم',
  'نوزدهم',
  'بیستم',
];

/** عنوان ثابت و قابل‌پیش‌بینی هر حالت بر اساس جایگاه آن در فهرست */
export function tierLabel(index: number): string {
  const ordinal = Math.max(1, Math.floor(Number.isFinite(index) ? index : 0) + 1);
  const word = PERSIAN_ORDINALS[ordinal - 1];
  return word ? `حالت ${word}` : `حالت شمارهٔ ${toFa(ordinal)}`;
}

/** نام حالت‌ها را پس از افزودن، حذف یا جابه‌جایی دوباره بر اساس ترتیب می‌سازد. */
export function labelTiers(tiers: Tier[]): Tier[] {
  return tiers.map((tier, index) => ({ ...tier, name: tierLabel(index) }));
}

export interface Preset {
  key: string;
  name: string;
  description: string;
  contractType: ContractType;
  rate: number;
  loanCap: number;
  /** نرخ سود پرداختی روی خود سپرده؛ صفر یعنی الگوی سپرده بدون سود */
  depositProfitRate: number;
  tiers: Omit<Tier, 'id'>[];
}

/**
 * سه الگوی عمومی و قابل‌ویرایش برای شروع طراحی محصول.
 * اعداد صرفاً نمونه‌اند و به محصول یا مؤسسهٔ مشخصی نسبت داده نمی‌شوند.
 */
export const PRESETS: Preset[] = [
  {
    key: 'sample-1',
    name: 'نمونه طرح اول',
    description: 'الگوی قرض‌الحسنه با دوره‌های انتظار و بازپرداخت متنوع؛ همهٔ ضرایب و حدود صرفاً نمونه و قابل ویرایش‌اند.',
    contractType: 'qard',
    rate: 4,
    loanCap: 300_000_000,
    depositProfitRate: 0,
    tiers: [
      { name: tierLabel(0), tDep: 1, tLoan: 6, alpha: 60, minBalance: 5_000_000, allocation: 10, rateOverride: null },
      { name: tierLabel(1), tDep: 3, tLoan: 12, alpha: 90, minBalance: 10_000_000, allocation: 15, rateOverride: null },
      { name: tierLabel(2), tDep: 6, tLoan: 24, alpha: 90, minBalance: 20_000_000, allocation: 25, rateOverride: null },
      { name: tierLabel(3), tDep: 12, tLoan: 12, alpha: 370, minBalance: 30_000_000, allocation: 20, rateOverride: null },
      { name: tierLabel(4), tDep: 12, tLoan: 36, alpha: 125, minBalance: 30_000_000, allocation: 20, rateOverride: null },
      { name: tierLabel(5), tDep: 12, tLoan: 60, alpha: 75, minBalance: 30_000_000, allocation: 10, rateOverride: null },
    ],
  },
  {
    key: 'sample-2',
    name: 'نمونه طرح دوم',
    description: 'الگوی قرض‌الحسنه برای آزمودن گزینه‌های مختلف؛ ترکیب ۴ ماه انتظار و ۱۲ قسط نیز در آن تعریف شده است.',
    contractType: 'qard',
    rate: 4,
    loanCap: 300_000_000,
    depositProfitRate: 0,
    tiers: [
      { name: tierLabel(0), tDep: 1, tLoan: 12, alpha: 27, minBalance: 1_000_000, allocation: 10, rateOverride: null },
      { name: tierLabel(1), tDep: 3, tLoan: 24, alpha: 40, minBalance: 1_000_000, allocation: 15, rateOverride: null },
      { name: tierLabel(2), tDep: 4, tLoan: 12, alpha: 110, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: tierLabel(3), tDep: 6, tLoan: 36, alpha: 60, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: tierLabel(4), tDep: 12, tLoan: 12, alpha: 320, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: tierLabel(5), tDep: 12, tLoan: 60, alpha: 60, minBalance: 1_000_000, allocation: 15, rateOverride: null },
    ],
  },
  {
    key: 'sample-3',
    name: 'نمونه طرح سوم',
    description:
      'الگوی مرابحه با ۱۲ حالت پلکانی و هم‌راستا: از انتظار ۳ ماهه با نرخ ۵٪ و بازپرداخت ۱۲ ماهه آغاز می‌شود و پله‌پله تا انتظار ۱۲ ماهه، نرخ ۲۳٪ و بازپرداخت ۶۰ ماهه بالا می‌رود؛ سهم پله‌های کوتاه‌مدت بیشتر است چون زودتر نقد می‌شوند.',
    contractType: 'murabaha',
    rate: 21,
    loanCap: 400_000_000,
    depositProfitRate: 20.5,
    /**
     * نردبان ۱۲ پله‌ای نمونهٔ سوم.
     *
     * چهار ستون طراحی به‌طور یکنواخت و هم‌جهت بالا می‌روند تا فهرست حالت‌ها
     * قابل خواندن و قابل دفاع باشد:
     *   • دورهٔ انتظار    ۳ ← ۱۲ ماه
     *   • دورهٔ بازپرداخت ۱۲ ← ۶۰ ماه
     *   • نرخ عقد         ۵٪ ← ۲۳٪ (جدول نرخ مصوب محصول؛ نرخ اختصاصی هر پله)
     *   • ضریب برابری α   ۱۰۰٪ ← ۱۶۰٪ (انتظار بلندتر = تسهیلات بزرگ‌تر)
     *
     * «سهم تخصیص» تنها ستونی است که نزولی است و این عمدی است: پله‌های
     * کوتاه‌مدت اقساطشان درون افق ۶۰ ماهه کامل وصول می‌شود، پس منابع زودتر
     * برمی‌گردد و کسری نقدینگی و هزینهٔ تأمین بین‌بانکی کمتر می‌شود.
     *
     * ⚠ نکتهٔ ساختاری: نرخ سود سپرده ۲۰.۵٪ از ۱۰ پله از ۱۲ پلهٔ جدول نرخ
     * بالاتر است، بنابراین سود پرداختی به سپرده‌گذار (≈۱۳.۴ میلیارد ریال)
     * از کل درآمد درون افق (≈۱۰.۶ میلیارد ریال) بیشتر است و این طرح با هر
     * چینش پله‌ای زیان‌ده می‌ماند. تنها متغیر آزاد باقی‌مانده «نرخ سود
     * سپرده» است؛ با همین نردبان و فقط تغییر آن: ۱۲٪ → ≈−۵٫۹۵ میلیارد،
     * ۵٪ → ≈+۰٫۰۷ میلیارد و ۰٪ → ≈+۴٫۲۰ میلیارد ریال.
     */
    tiers: [
      { name: tierLabel(0), tDep: 3, tLoan: 12, alpha: 100, minBalance: 1_000_000, allocation: 13.87, rateOverride: 5 },
      { name: tierLabel(1), tDep: 3, tLoan: 16, alpha: 105, minBalance: 1_000_000, allocation: 12.88, rateOverride: 9 },
      { name: tierLabel(2), tDep: 4, tLoan: 21, alpha: 110, minBalance: 1_000_000, allocation: 11.87, rateOverride: 10 },
      { name: tierLabel(3), tDep: 5, tLoan: 25, alpha: 115, minBalance: 1_000_000, allocation: 10.86, rateOverride: 13 },
      { name: tierLabel(4), tDep: 6, tLoan: 29, alpha: 120, minBalance: 1_000_000, allocation: 9.85, rateOverride: 15 },
      { name: tierLabel(5), tDep: 6, tLoan: 34, alpha: 125, minBalance: 1_000_000, allocation: 8.84, rateOverride: 16 },
      { name: tierLabel(6), tDep: 7, tLoan: 38, alpha: 135, minBalance: 1_000_000, allocation: 7.83, rateOverride: 17 },
      { name: tierLabel(7), tDep: 8, tLoan: 43, alpha: 140, minBalance: 1_000_000, allocation: 6.82, rateOverride: 18 },
      { name: tierLabel(8), tDep: 9, tLoan: 47, alpha: 145, minBalance: 1_000_000, allocation: 5.81, rateOverride: 19 },
      { name: tierLabel(9), tDep: 10, tLoan: 51, alpha: 150, minBalance: 1_000_000, allocation: 4.8, rateOverride: 20 },
      { name: tierLabel(10), tDep: 11, tLoan: 56, alpha: 155, minBalance: 1_000_000, allocation: 3.79, rateOverride: 21 },
      { name: tierLabel(11), tDep: 12, tLoan: 60, alpha: 160, minBalance: 1_000_000, allocation: 2.78, rateOverride: 23 },
    ],
  },
];

export const DEFAULT_PRESET = 'sample-2';

export function presetTiers(key: string): Tier[] {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0];
  return labelTiers(p.tiers.map((t) => ({ ...t, id: uid() })));
}

export const DEFAULT_CONFIG: GlobalConfig = {
  contractType: 'qard',
  qardFeeRate: 4,
  murabahaRate: 21,
  reserveRatio: 10,
  loanCap: 300_000_000,
  horizon: 60,
  initialLiquidity: 0,
  releaseReserve: false,
  defaultRate: 0,
  lgdRate: 100,
  writeOffLag: 12,
  interbankRate: 23,
  opportunityRate: 23,
  depositProfitRate: 0,
};

export const DEFAULT_BEHAVIOR: Behavior = {
  totalDeposit: 50_000_000_000,
  avgTicket: 100_000_000,
  takeUpRate: 80,
  approvalRate: 90,
  runoffRate: 90,
  churnRate: 50,
};

export const DEFAULT_SCHEDULE: DepositSchedule = {
  mode: 'lump',
  uniformMonths: 12,
  custom: [
    { id: 'v0', month: 0, share: 50 },
    { id: 'v1', month: 3, share: 30 },
    { id: 'v2', month: 6, share: 20 },
  ],
};

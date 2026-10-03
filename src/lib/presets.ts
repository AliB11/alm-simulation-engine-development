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

export type PresetRange = readonly [minimum: number, maximum: number];

export interface Preset {
  key: string;
  name: string;
  description: string;
  contractType: ContractType;
  rate: number;
  loanCap: number;
  /** نرخ‌های مجاز محصول برای انتخاب کاربر؛ برای نمونهٔ نگین امید زرین */
  rateOptions?: readonly number[];
  /** گزینه‌های اقساطی که این الگو نمایش می‌دهد */
  repaymentTerms?: readonly number[];
  /** سقف کل اعلام‌شدهٔ محصول؛ ممکن است با سقف هر فرد تفاوت داشته باشد */
  programCap?: number;
  /** دامنه‌های نمایشی مشخصات همین الگو (به‌ترتیب: حداقل، حداکثر) */
  waitingRange?: PresetRange;
  alphaRange?: PresetRange;
  tierRateRange?: PresetRange;
  /** نرخ سود پرداختی روی خود سپرده؛ صفر یعنی الگوی سپرده بدون سود */
  depositProfitRate: number;
  tiers: Omit<Tier, 'id'>[];
}

const SAMPLE_ONE_REPAYMENT_TERMS = [12, 24, 36, 48, 60] as const;
const SAMPLE_THREE_REPAYMENT_TERMS = [16, 24, 32, 40, 48, 56, 60] as const;

/**
 * دو الگوی قابل‌ویرایش برای شروع طراحی محصول.
 * اعدادِ طرح نگین امید زرین بر پایهٔ شرایط عمومی منتشرشده چیده شده‌اند؛
 * تخصیص‌ها و جفت‌کردن هر پله با یک دوره، فرض‌های شبیه‌سازی‌اند نه قرارداد بانک.
 */
export const PRESETS: Preset[] = [
  {
    key: 'sample-1',
    name: 'نمونه طرح اول',
    description:
      'قرض‌الحسنه با کارمزد انتخابی ۰، ۲ یا ۴٪؛ شش حالت با دورهٔ انتظار پله‌ای ۱، ۳، ۶، ۹، ۱۲ و ۱۸ ماه — هرچه انتظار طولانی‌تر، ضریب برابری بیشتر و کارمزد پیش‌فرض کمتر — اقساط ۱۲/۲۴/۳۶/۴۸/۶۰ ماه و ضریب ۲٫۵٪ تا ۲۲۵٪. سقف کل اعلامی ۱ میلیارد تومان است؛ چون منابع درباره سقف فردی اختلاف دارند، مدل به‌طور محافظه‌کارانه ۳۰۰ میلیون می‌گیرد. ضرایب و سهم‌ها آموزشی‌اند.',
    contractType: 'qard',
    rate: 2,
    rateOptions: [0, 2, 4],
    repaymentTerms: SAMPLE_ONE_REPAYMENT_TERMS,
    waitingRange: [1, 18],
    alphaRange: [2.5, 225],
    programCap: 1_000_000_000,
    loanCap: 300_000_000,
    depositProfitRate: 0,
    tiers: [
      /* شش ردهٔ انتظار ۱ تا ۱۸ ماه؛ ضریب و اقساط هر رده از نردبان قبلی حفظ
         شده و انتظار هر رده یک پله بالاتر رفته است تا کل بازهٔ اعلامی پوشش
         داده شود (پیش‌تر پنج رده روی ۱۸ ماه گیر کرده بود). کارمزد پیش‌فرض
         هر رده هم پله‌ای است: انتظار کوتاه‌تر ⇒ کارمزد بالاتر، و مشتری می‌تواند
         هر رده را روی ۰/۲/۴٪ یا نرخ سراسری بگذارد. */
      { name: tierLabel(0), tDep: 1, tLoan: 12, alpha: 2.5, minBalance: 0, allocation: 60, rateOverride: 4 },
      { name: tierLabel(1), tDep: 3, tLoan: 60, alpha: 45, minBalance: 0, allocation: 6, rateOverride: 4 },
      { name: tierLabel(2), tDep: 6, tLoan: 48, alpha: 56.25, minBalance: 0, allocation: 9, rateOverride: 2 },
      { name: tierLabel(3), tDep: 9, tLoan: 36, alpha: 75, minBalance: 0, allocation: 12, rateOverride: 2 },
      { name: tierLabel(4), tDep: 12, tLoan: 24, alpha: 112.5, minBalance: 0, allocation: 10, rateOverride: 0 },
      { name: tierLabel(5), tDep: 18, tLoan: 12, alpha: 225, minBalance: 0, allocation: 3, rateOverride: 0 },
    ],
  },
  {
    key: 'sample-3',
    name: 'نمونه طرح سوم',
    description:
      'الگوی مرابحهٔ ۷ پله‌ای؛ انتظار از ۲ تا ۱۲ ماه، اقساط ۱۶/۲۴/۳۲/۴۰/۴۸/۵۶/۶۰ ماه، ضریب برابری ۲۵٪ تا ۲۰۰٪ و نرخ اختصاصی ۵٪ تا ۲۳٪. سهم‌های تخصیص، فرض‌های آموزشی و قابل‌ویرایش‌اند.',
    contractType: 'murabaha',
    rate: 21,
    repaymentTerms: SAMPLE_THREE_REPAYMENT_TERMS,
    waitingRange: [2, 12],
    alphaRange: [25, 200],
    tierRateRange: [5, 23],
    loanCap: 400_000_000,
    depositProfitRate: 0.1,
    tiers: [
      { name: tierLabel(0), tDep: 2, tLoan: 16, alpha: 25, minBalance: 1_000_000, allocation: 30, rateOverride: 5 },
      { name: tierLabel(1), tDep: 3, tLoan: 24, alpha: 50, minBalance: 1_000_000, allocation: 20, rateOverride: 8 },
      { name: tierLabel(2), tDep: 4, tLoan: 32, alpha: 75, minBalance: 1_000_000, allocation: 16, rateOverride: 11 },
      { name: tierLabel(3), tDep: 6, tLoan: 40, alpha: 100, minBalance: 1_000_000, allocation: 13, rateOverride: 14 },
      { name: tierLabel(4), tDep: 8, tLoan: 48, alpha: 125, minBalance: 1_000_000, allocation: 9, rateOverride: 17 },
      { name: tierLabel(5), tDep: 10, tLoan: 56, alpha: 160, minBalance: 1_000_000, allocation: 7, rateOverride: 20 },
      { name: tierLabel(6), tDep: 12, tLoan: 60, alpha: 200, minBalance: 1_000_000, allocation: 5, rateOverride: 23 },
    ],
  },
];

/** نمونهٔ اول، الگوی شروع و طرح پیش‌فرض برنامه است. */
export const DEFAULT_PRESET = 'sample-1';

export function presetTiers(key: string): Tier[] {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0];
  return labelTiers(p.tiers.map((t) => ({ ...t, id: uid() })));
}

export const DEFAULT_CONFIG: GlobalConfig = {
  contractType: 'qard',
  qardFeeRate: 2,
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

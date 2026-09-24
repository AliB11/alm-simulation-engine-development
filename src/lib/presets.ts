import type { Behavior, ContractType, DepositSchedule, GlobalConfig, Tier } from '../types';

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

export interface Preset {
  key: string;
  name: string;
  bank: string;
  description: string;
  contractType: ContractType;
  rate: number;
  loanCap: number;
  /** نرخ سود پرداختی روی خود سپرده (سپردهٔ قرض‌الحسنه = ۰، سپردهٔ سرمایه‌گذاری = نرخ مصوب) */
  depositProfitRate: number;
  tiers: Omit<Tier, 'id'>[];
}

/**
 * الگوهای واقعی بازار — برگرفته از اطلاعات منتشرشده عمومی
 * (ضرایب برخی پله‌ها تقریبی‌اند و صرفاً برای شبیه‌سازی ارائه شده‌اند)
 */
export const PRESETS: Preset[] = [
  {
    key: 'mehrabani',
    name: 'طرح مهربانی',
    bank: 'بانک ملی ایران',
    description:
      'قرض‌الحسنه با کارمزد ۴٪، میانگین‌گیری ۱ تا ۱۲ ماه، بازپرداخت ۶ تا ۶۰ ماه، حداکثر ضریب ۳۷۰٪ و سقف فردی ۳۰۰ میلیون تومان؛ بدون مسدودی سپرده.',
    contractType: 'qard',
    rate: 4,
    loanCap: 300_000_000,
    depositProfitRate: 0,
    tiers: [
      { name: 'مهربانی ۱ ماهه / ۶ قسط', tDep: 1, tLoan: 6, alpha: 60, minBalance: 5_000_000, allocation: 10, rateOverride: null },
      { name: 'مهربانی ۳ ماهه / ۱۲ قسط', tDep: 3, tLoan: 12, alpha: 90, minBalance: 10_000_000, allocation: 15, rateOverride: null },
      { name: 'مهربانی ۶ ماهه / ۲۴ قسط', tDep: 6, tLoan: 24, alpha: 90, minBalance: 20_000_000, allocation: 25, rateOverride: null },
      { name: 'مهربانی ۱۲ ماهه / ۱۲ قسط', tDep: 12, tLoan: 12, alpha: 370, minBalance: 30_000_000, allocation: 20, rateOverride: null },
      { name: 'مهربانی ۱۲ ماهه / ۳۶ قسط', tDep: 12, tLoan: 36, alpha: 125, minBalance: 30_000_000, allocation: 20, rateOverride: null },
      { name: 'مهربانی ۱۲ ماهه / ۶۰ قسط', tDep: 12, tLoan: 60, alpha: 75, minBalance: 30_000_000, allocation: 10, rateOverride: null },
    ],
  },
  {
    key: 'nikvam',
    name: 'طرح نیک‌وام',
    bank: 'بانک ملت',
    description:
      'حساب قرض‌الحسنه پس‌انداز نیک؛ کارمزد ۴٪، معدل‌گیری ۱ تا ۱۲ ماه، ضریب ۱۰٪ تا ۳۲۰٪ متناسب با مدت بازپرداخت ۱۲ تا ۶۰ ماه، سقف فردی ۳۰۰ میلیون تومان.',
    contractType: 'qard',
    rate: 4,
    loanCap: 300_000_000,
    depositProfitRate: 0,
    tiers: [
      { name: 'نیک ۱ ماهه / ۱۲ قسط', tDep: 1, tLoan: 12, alpha: 27, minBalance: 1_000_000, allocation: 10, rateOverride: null },
      { name: 'نیک ۳ ماهه / ۲۴ قسط', tDep: 3, tLoan: 24, alpha: 40, minBalance: 1_000_000, allocation: 15, rateOverride: null },
      { name: 'نیک ۴ ماهه / ۱۲ قسط', tDep: 4, tLoan: 12, alpha: 110, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: 'نیک ۶ ماهه / ۳۶ قسط', tDep: 6, tLoan: 36, alpha: 60, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: 'نیک ۱۲ ماهه / ۱۲ قسط', tDep: 12, tLoan: 12, alpha: 320, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: 'نیک ۱۲ ماهه / ۶۰ قسط', tDep: 12, tLoan: 60, alpha: 60, minBalance: 1_000_000, allocation: 15, rateOverride: null },
    ],
  },
  {
    key: 'negin',
    name: 'طرح نگین فراپویا',
    bank: 'بانک سپه',
    description:
      'سپرده کوتاه‌مدت ماه‌شمار ویژه (با سود پرداختی ≈۲۰٫۵٪ سالانه) + تسهیلات مرابحه ۵ تا ۲۱٪؛ انتظار ۳ تا ۱۲ ماه؛ ضریب ۲۵ تا ۲۰۰٪؛ هر ماه انتظار اضافه = ۸ قسط بیشتر یا ۲۵٪ ضریب بیشتر یا ۲٪ نرخ کمتر.',
    contractType: 'murabaha',
    rate: 21,
    loanCap: 400_000_000,
    depositProfitRate: 20.5,
    tiers: [
      { name: 'نگین پایه ۳ ماهه', tDep: 3, tLoan: 16, alpha: 25, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: 'نگین ۶ ماهه — افزایش ضریب', tDep: 6, tLoan: 16, alpha: 100, minBalance: 1_000_000, allocation: 20, rateOverride: null },
      { name: 'نگین ۶ ماهه — افزایش اقساط', tDep: 6, tLoan: 40, alpha: 25, minBalance: 1_000_000, allocation: 15, rateOverride: null },
      { name: 'نگین ۸ ماهه — کاهش نرخ', tDep: 8, tLoan: 16, alpha: 25, minBalance: 1_000_000, allocation: 15, rateOverride: 11 },
      { name: 'نگین ۱۰ ماهه — حداکثر ضریب', tDep: 10, tLoan: 16, alpha: 200, minBalance: 1_000_000, allocation: 15, rateOverride: null },
      { name: 'نگین ۱۲ ماهه — ترکیبی', tDep: 12, tLoan: 32, alpha: 200, minBalance: 1_000_000, allocation: 15, rateOverride: null },
    ],
  },
];

export const DEFAULT_PRESET = 'nikvam';

export function presetTiers(key: string): Tier[] {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0];
  return p.tiers.map((t) => ({ ...t, id: uid() }));
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

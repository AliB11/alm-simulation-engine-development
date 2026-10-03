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
  /** سقف کل گزارش‌شدهٔ محصول برای نمایش اطلاع‌رسانی؛ محدودیت تجمیعی موتور نیست */
  programCap?: number;
  /** حداقل مبلغ تسهیلات محصول (تومان)؛ صفر/خالی یعنی بدون کف */
  minLoan?: number;
  /** دامنه‌های نمایشی مشخصات همین الگو (به‌ترتیب: حداقل، حداکثر) */
  waitingRange?: PresetRange;
  alphaRange?: PresetRange;
  /** ضریب برابری بر اساس کارمزد انتخاب‌شده؛ برای حالت‌های قرض‌الحسنهٔ نمونهٔ اول */
  rateAlphaRanges?: Readonly<Record<number, PresetRange>>;
  tierRateRange?: PresetRange;
  /**
   * قاعدهٔ خودِ محصول برای مجازبودن یک ترکیب «دورهٔ انتظار / دورهٔ بازپرداخت».
   * سازندهٔ پله‌ها با آن به ویرایش‌های خارج از قاعده هشدار می‌دهد (بدون مسدودسازی).
   */
  modeFeasible?: (tDep: number, tLoan: number) => boolean;
  /** متن کوتاه همان قاعده برای راهنمای هشدار */
  modeRule?: string;
  /** نرخ سود پرداختی روی خود سپرده؛ صفر یعنی الگوی سپرده بدون سود */
  depositProfitRate: number;
  tiers: Omit<Tier, 'id'>[];
}

const SAMPLE_ONE_REPAYMENT_TERMS = [12, 24, 36, 48, 60] as const;
const SAMPLE_TWO_REPAYMENT_TERMS = [16, 24, 32, 40, 48, 56, 60] as const;

/** ضریب مقیاسِ نسبت تسهیلات به میانگین سپرده در کارمزدهای منتشرشده */
const SAMPLE_ONE_ALPHA_FACTORS: Readonly<Record<number, number>> = { 0: 150, 2: 200, 4: 240 };
const SAMPLE_ONE_ALPHA_RANGES: Readonly<Record<number, PresetRange>> = {
  0: [2.5, 225],
  2: [3.33, 300],
  4: [4, 360],
};

/**
 * بازسازی ضریب هر حالت از دامنه‌های گزارش‌شدهٔ طرح:
 * α(٪) = ضریبِ کارمزد × ماه انتظار ÷ ماه بازپرداخت.
 * مقادیر تا دو رقم اعشار گرد می‌شوند؛ جدول کاملِ قرارداد بانک در دسترس نیست.
 */
export function sampleOneAlpha(waitingMonths: number, repaymentMonths: number, feeRate: number): number {
  const factor = SAMPLE_ONE_ALPHA_FACTORS[feeRate] ?? SAMPLE_ONE_ALPHA_FACTORS[2];
  const wait = Number.isFinite(waitingMonths) ? Math.max(0, waitingMonths) : 0;
  const term = Number.isFinite(repaymentMonths) ? Math.max(1, repaymentMonths) : 1;
  return Math.round(((factor * wait) / term) * 100) / 100;
}

function sampleOneTiers(feeRate: number): Omit<Tier, 'id'>[] {
  const allocation = 100 / (18 * SAMPLE_ONE_REPAYMENT_TERMS.length);
  const tiers: Omit<Tier, 'id'>[] = [];
  for (let waiting = 1; waiting <= 18; waiting++) {
    for (const repayment of SAMPLE_ONE_REPAYMENT_TERMS) {
      tiers.push({
        name: tierLabel(tiers.length),
        tDep: waiting,
        tLoan: repayment,
        alpha: sampleOneAlpha(waiting, repayment, feeRate),
        minBalance: 0,
        allocation,
        rateOverride: null,
      });
    }
  }
  return tiers;
}

/* ----------------------- نمونهٔ دوم: نگین فراپویا ----------------------- */

/**
 * پارامترهای منتشرشدهٔ محصول «نگین فراپویا» بانک سپه (مرابحهٔ سپرده‌محور،
 * ویژهٔ اشخاص حقیقی، با حساب کوتاه‌مدت ماه‌شمارِ ویژهٔ طرح و قابلیت واریز/برداشت):
 *
 *   • دورهٔ میانگین‌گیری (انتظار): ۲ تا ۱۲ ماه
 *   • اقساط مجاز: ۱۶/۲۴/۳۲/۴۰/۴۸/۵۶/۶۰ ماه
 *   • ضریب تسهیلات به میانگین سپرده: ۲۵٪ تا ۲۰۰٪
 *   • نرخ سود تسهیلات: ۵٪ تا ۲۳٪
 *   • حداقل میانگین سپرده برای بهره‌مندی: ۱۰ میلیون ریال (۱ میلیون تومان)
 *   • حداقل مبلغ تسهیلات ۱۰۰ میلیون ریال و سقف فردی ۴ میلیارد ریال (۴۰۰ میلیون تومان)
 *   • نرخ سود علی‌الحساب خودِ سپرده: ۰٫۰۱٪
 *   • قاعدهٔ امتیاز: به ازای هر ماه انتظارِ بیشتر از حداقلِ ۲ ماه، یکی از سه مزیت
 *     زیر (یا ترکیبی از آن‌ها) به متقاضی می‌رسد:
 *       ۱) ۸ ماه افزودن به دورهٔ بازپرداخت، تا سقف ۶۰ ماه
 *       ۲) ۲۵ واحد درصد افزودن به ضریب تسهیلات، تا سقف ۲۰۰٪
 *       ۳) ۲ واحد درصد کاستن از نرخ سود، تا کف ۵٪
 *     و اقساط بالاتر از ۴۸ ماه فقط شامل حالت‌هایی با انتظارِ بیش از ۲ ماه می‌شود.
 *
 * منابع: سامانهٔ تسهیلاتی سپه (vamyarsepah.com)، بنکر ۶ شهریور ۱۴۰۵،
 * اقتصادآنلاین و نواندیش شهریور ۱۴۰۵، بانک‌اول ۱۴۰۵.
 */
export const FARAPOUYA = {
  minWait: 2,
  maxWait: 12,
  terms: SAMPLE_TWO_REPAYMENT_TERMS,
  /** سقف اقساط در حداقل انتظار (۲ ماه) */
  baseTerm: 48,
  termStep: 8,
  maxTerm: 60,
  alphaBase: 25,
  alphaStep: 25,
  alphaCap: 200,
  rateBase: 23,
  rateStep: 2,
  rateFloor: 5,
  minBalance: 1_000_000,
  minLoan: 10_000_000,
  loanCap: 400_000_000,
  depositProfitRate: 0.01,
} as const;

/** تعداد گام لازم برای رسیدن هر مزیت به کران منتشرشده‌اش (۹ گام تا کف ۵٪ و ۷ گام تا سقف ۲۰۰٪) */
export const FARAPOUYA_RATE_STEPS = (FARAPOUYA.rateBase - FARAPOUYA.rateFloor) / FARAPOUYA.rateStep;
export const FARAPOUYA_ALPHA_STEPS = (FARAPOUYA.alphaCap - FARAPOUYA.alphaBase) / FARAPOUYA.alphaStep;

function intInRange(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** امتیاز کسب‌شده از انتظار: هر ماه بیش از حداقل دورهٔ میانگین‌گیری (۲ ماه) = یک امتیاز */
export function farapouyaPoints(waitingMonths: number): number {
  return intInRange(waitingMonths, FARAPOUYA.minWait, FARAPOUYA.maxWait, FARAPOUYA.minWait) - FARAPOUYA.minWait;
}

/** امتیازی که یک دورهٔ بازپرداختِ بالاتر از سقف پایه (۴۸ ماه) مصرف می‌کند */
export function farapouyaTermPoints(repaymentMonths: number): number {
  const term = intInRange(repaymentMonths, 0, FARAPOUYA.maxTerm, FARAPOUYA.baseTerm);
  if (term <= FARAPOUYA.baseTerm) return 0;
  return Math.ceil((term - FARAPOUYA.baseTerm) / FARAPOUYA.termStep);
}

/** سقف دورهٔ بازپرداختِ مجاز برای یک دورهٔ انتظار مشخص */
export function farapouyaTermCeiling(waitingMonths: number): number {
  return Math.min(FARAPOUYA.maxTerm, FARAPOUYA.baseTerm + FARAPOUYA.termStep * farapouyaPoints(waitingMonths));
}

/** آیا این ترکیبِ انتظار/اقساط طبق قاعدهٔ محصول مجاز است؟ */
export function farapouyaFeasible(waitingMonths: number, repaymentMonths: number): boolean {
  return farapouyaTermPoints(repaymentMonths) <= farapouyaPoints(waitingMonths);
}

export interface FarapouyaMode {
  /** دورهٔ انتظار (ماه) */
  waiting: number;
  /** دورهٔ بازپرداخت (ماه) */
  term: number;
  /** امتیاز کسب‌شده از انتظار */
  points: number;
  /** امتیاز مصرف‌شده برای اقساط */
  termPoints: number;
  /** امتیاز باقی‌مانده برای ضریب و نرخ */
  freePoints: number;
  /** گام‌های کاهش نرخ */
  rateSteps: number;
  /** گام‌های افزایش ضریب */
  alphaSteps: number;
  /** ضریب تسهیلات به میانگین سپرده (درصد) */
  alpha: number;
  /** نرخ سود مرابحه (درصد) */
  rate: number;
  feasible: boolean;
}

/**
 * بازسازی یک حالت از محصول نگین فراپویا.
 *
 * امتیاز باقی‌مانده پس از خریدِ اقساط، با «سیاست ترکیبیِ متناسب» بین کاهش نرخ و
 * افزایش ضریب تقسیم می‌شود: سهم هر مزیت به نسبت هزینهٔ کاملِ همان مزیت است
 * (۹ گام برای رسیدن نرخ به کف ۵٪ و ۷ گام برای رسیدن ضریب به سقف ۲۰۰٪)، پس هر دو
 * مزیت با یک سرعت نسبی پیش می‌روند. این یک بازسازی شفافِ موتور است، نه جدول رسمی
 * قرارداد؛ جدول کامل حالت‌های بانک منتشر نشده و هر دو فیلد در رابط کاربری
 * قابل‌ویرایش‌اند. توجه: رسیدنِ هم‌زمان به ضریب ۲۰۰٪ و نرخ ۵٪ به ۱۶ امتیاز
 * (۱۸ ماه انتظار) نیاز دارد و با سقفِ ۱۲ ماهِ محصول ممکن نیست.
 */
export function farapouyaMode(waitingMonths: number, repaymentMonths: number): FarapouyaMode {
  const waiting = intInRange(waitingMonths, FARAPOUYA.minWait, FARAPOUYA.maxWait, FARAPOUYA.minWait);
  const term = intInRange(repaymentMonths, 0, FARAPOUYA.maxTerm, FARAPOUYA.baseTerm);
  const points = waiting - FARAPOUYA.minWait;
  const termPoints = farapouyaTermPoints(term);
  const freePoints = Math.max(0, points - termPoints);
  const rateSteps = Math.min(
    FARAPOUYA_RATE_STEPS,
    Math.round((freePoints * FARAPOUYA_RATE_STEPS) / (FARAPOUYA_RATE_STEPS + FARAPOUYA_ALPHA_STEPS)),
  );
  const alphaSteps = Math.min(FARAPOUYA_ALPHA_STEPS, freePoints - rateSteps);
  return {
    waiting,
    term,
    points,
    termPoints,
    freePoints,
    rateSteps,
    alphaSteps,
    alpha: Math.min(FARAPOUYA.alphaCap, FARAPOUYA.alphaBase + FARAPOUYA.alphaStep * alphaSteps),
    rate: Math.max(FARAPOUYA.rateFloor, FARAPOUYA.rateBase - FARAPOUYA.rateStep * rateSteps),
    feasible: termPoints <= points,
  };
}

/** ضریب بازسازی‌شدهٔ یک حالت (درصد) */
export function farapouyaAlpha(waitingMonths: number, repaymentMonths: number): number {
  return farapouyaMode(waitingMonths, repaymentMonths).alpha;
}

/** نرخ سود بازسازی‌شدهٔ یک حالت (درصد) */
export function farapouyaRate(waitingMonths: number, repaymentMonths: number): number {
  return farapouyaMode(waitingMonths, repaymentMonths).rate;
}

/**
 * همهٔ حالت‌های مجاز محصول به‌ترتیب انتظار و سپس اقساط.
 * ۱۱ دورهٔ انتظار × ۷ دورهٔ بازپرداخت = ۷۷ ترکیب که ۳ ترکیب ناموجه آن
 * (۵۶ و ۶۰ قسط در انتظار ۲ ماه، و ۶۰ قسط در انتظار ۳ ماه) حذف می‌شوند: ۷۴ حالت.
 */
export function farapouyaModes(): FarapouyaMode[] {
  const modes: FarapouyaMode[] = [];
  for (let waiting = FARAPOUYA.minWait; waiting <= FARAPOUYA.maxWait; waiting++) {
    for (const term of FARAPOUYA.terms) {
      const mode = farapouyaMode(waiting, term);
      if (mode.feasible) modes.push(mode);
    }
  }
  return modes;
}

function sampleTwoTiers(): Omit<Tier, 'id'>[] {
  const modes = farapouyaModes();
  const allocation = 100 / modes.length;
  return modes.map((mode, index) => ({
    name: tierLabel(index),
    tDep: mode.waiting,
    tLoan: mode.term,
    alpha: mode.alpha,
    minBalance: FARAPOUYA.minBalance,
    allocation,
    rateOverride: mode.rate,
  }));
}

/** قاعدهٔ اقساط/انتظار نگین فراپویا، برای راهنمای هشدار در سازندهٔ پله‌ها */
const FARAPOUYA_MODE_RULE =
  'طبق قاعدهٔ محصول، هر ماه انتظار بیشتر از ۲ ماه یک امتیاز می‌سازد: ۸ ماه اقساط بیشتر (تا سقف ۶۰)، یا ۲۵ واحد درصد ضریب بیشتر (تا ۲۰۰٪)، یا ۲ واحد درصد نرخ کمتر (تا کف ۵٪). اقساط ۵۶ به انتظار دست‌کم ۳ ماه و اقساط ۶۰ به انتظار دست‌کم ۴ ماه نیاز دارد.';

/**
 * دو الگوی قابل‌ویرایش برای شروع طراحی محصول.
 * طرح اول همهٔ ۹۰ جفتِ دورهٔ انتظار/بازپرداخت را نگه می‌دارد؛ نسبت‌ها از دامنه‌های
 * گزارش‌شده بازسازی شده‌اند و تخصیص برابر صرفاً پیش‌فرض شبیه‌سازی است.
 * طرح دوم ۷۴ حالتِ مجازِ نگین فراپویا را از قاعدهٔ امتیازِ همان محصول می‌سازد.
 */
export const PRESETS: Preset[] = [
  {
    key: 'sample-1',
    name: 'نمونه طرح اول',
    description:
      'نگین امید زرین: ۹۰ حالتِ ۱۸ دوره انتظار × ۵ دوره بازپرداخت؛ کارمزد ۰/۲/۴٪ و ضریب وابسته به کارمزد (به‌ترتیب دامنهٔ ۲٫۵–۲۲۵، ۳٫۳۳–۳۰۰ و ۴–۳۶۰٪). تخصیص برابر فقط فرض آغازین شبیه‌سازی است، نه سهم رسمی هر حالت.',
    contractType: 'qard',
    rate: 2,
    rateOptions: [0, 2, 4],
    repaymentTerms: SAMPLE_ONE_REPAYMENT_TERMS,
    waitingRange: [1, 18],
    alphaRange: SAMPLE_ONE_ALPHA_RANGES[2],
    rateAlphaRanges: SAMPLE_ONE_ALPHA_RANGES,
    programCap: 1_000_000_000,
    minLoan: 0,
    loanCap: 300_000_000,
    depositProfitRate: 0,
    tiers: sampleOneTiers(2),
  },
  {
    /* کلید داخلی `sample-3` ثابت می‌ماند تا سناریوهای ذخیره‌شده در حافظهٔ مرورگر و
       فایل‌های خروجیِ نسخه‌های پیشین نشکنند؛ فقط برچسب فارسیِ الگو از
       برچسب قدیمیِ این الگو به «نمونه طرح دوم» تغییر کرده است. */
    key: 'sample-3',
    name: 'نمونه طرح دوم',
    description:
      'نگین فراپویا بانک سپه: ۷۴ حالتِ مجاز از ۱۱ دورهٔ انتظار (۲ تا ۱۲ ماه) × ۷ دورهٔ بازپرداخت (۱۶ تا ۶۰ ماه)؛ امتیاز هر ماه انتظارِ بیشتر بین افزایش ضریب (تا ۲۰۰٪)، کاهش نرخ (تا کف ۵٪) و افزایش اقساط (تا ۶۰ ماه) تقسیم می‌شود. سهم برابر حالت‌ها فقط فرض آغازین شبیه‌سازی است، نه ترکیب رسمی مشتریان.',
    contractType: 'murabaha',
    rate: FARAPOUYA.rateBase,
    repaymentTerms: SAMPLE_TWO_REPAYMENT_TERMS,
    waitingRange: [FARAPOUYA.minWait, FARAPOUYA.maxWait],
    alphaRange: [FARAPOUYA.alphaBase, FARAPOUYA.alphaCap],
    tierRateRange: [FARAPOUYA.rateFloor, FARAPOUYA.rateBase],
    modeFeasible: farapouyaFeasible,
    modeRule: FARAPOUYA_MODE_RULE,
    minLoan: FARAPOUYA.minLoan,
    loanCap: FARAPOUYA.loanCap,
    depositProfitRate: FARAPOUYA.depositProfitRate,
    tiers: sampleTwoTiers(),
  },
];

/** نمونهٔ اول، الگوی شروع و طرح پیش‌فرض برنامه است. */
export const DEFAULT_PRESET = 'sample-1';

export function presetTiers(key: string, qardFeeRate?: number): Tier[] {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0];
  const source = p.key === 'sample-1' ? sampleOneTiers(qardFeeRate ?? p.rate) : p.tiers;
  return labelTiers(source.map((t) => ({ ...t, id: uid() })));
}

export const DEFAULT_CONFIG: GlobalConfig = {
  contractType: 'qard',
  qardFeeRate: 2,
  murabahaRate: 21,
  reserveRatio: 10,
  loanCap: 300_000_000,
  minLoan: 0,
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

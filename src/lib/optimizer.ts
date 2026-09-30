/* ------------------------------------------------------------------ *
 *  DESIGN OPTIMIZER — «طراح معکوس»
 *
 *  کاربر هدف و قیدها را تعیین می‌کند و موتور با جست‌وجوی مختصاتی
 *  چندشروعی (Multi-Start Coordinate Descent) روی سه اهرم طراحی،
 *  بهترین ترکیب را می‌یابد:
 *     1) alphaScale  — مقیاس ضرایب برابری (حجم تسهیلات)
 *     2) tDepShift   — جابه‌جایی دورهٔ انتظار همهٔ پله‌ها (زمان‌بندی خروج)
 *     3) tLoanShift  — جابه‌جایی دورهٔ بازپرداخت (زمان‌بندی ورود اقساط)
 *
 *  سه اصل حاکم بر جست‌وجو:
 *   • «موجه بودن» اولویت مطلق دارد؛ اگر هیچ طرحی همهٔ قیدها را برآورده
 *     نکرد، کم‌نقض‌ترین طرح (کمترین شدت نقض) پیشنهاد می‌شود — نه طرحی که
 *     فقط عدد هدف را بزرگ‌تر می‌کند و ریسک نقدینگی را چند برابر می‌سازد.
 *   • رتبه‌بندی بر پایهٔ «اثر انگشت طراحی» است نه ترکیب اهرم‌ها؛ دو ترکیب
 *     اهرم که به پله‌های یکسان می‌رسند یک نامزد شمرده می‌شوند تا فهرست
 *     نتایج پر از ردیف‌های تکراری نشود.
 *   • جست‌وجو کاملاً قطعی و بازتولیدپذیر است: اهرم‌ها هر بار روی پله‌های
 *     ورودی اعمال می‌شوند (نه تجمعی در حلقهٔ جست‌وجو) و نقاط شروع ثابت‌اند.
 * ------------------------------------------------------------------ */

import type { SimInput, SimKpis, Tier } from '../types';
import { EPS, bounded, finite, simulate } from './engine';
import { TIER_ALPHA_MAX, TIER_ALPHA_MIN, TIER_WAIT_MAX, TIER_WAIT_MIN } from './limits';
import { fmtNumber, fmtPct, fmtRatio, toFa } from './format';

export type Objective = 'margin' | 'income' | 'volume' | 'safety';
export interface DesignLevers {
  /** درصد — ۱۰۰ یعنی بدون تغییر */
  alphaScale: number;
  /** ماه — منفی یعنی انتظار کوتاه‌تر */
  tDepShift: number;
  /** ماه — منفی یعنی بازپرداخت کوتاه‌تر */
  tLoanShift: number;
}

export const NEUTRAL_LEVERS: DesignLevers = {
  alphaScale: 100,
  tDepShift: 0,
  tLoanShift: 0,
};

export const LEVER_GRID = {
  alphaScale: [75, 85, 100, 115, 125],
  tDepShift: [-3, -2, -1, 0, 1, 2, 3],
  tLoanShift: [-24, -12, 0, 12, 24],
};

export const OBJECTIVE_LABELS: Record<Objective, { label: string; hint: string }> = {
  margin: { label: 'حاشیهٔ خالص بانک', hint: 'بیشینه‌سازی درآمد منهای سود سپرده، هزینهٔ تأمین کسری و هزینهٔ ذخیره مطالبات' },
  income: { label: 'درآمد کارمزد / سود', hint: 'بیشینه‌سازی درآمد وصولی اقساط در افق' },
  volume: { label: 'حجم تسهیلات', hint: 'بیشینه‌سازی کل تعهد اعطای وام' },
  safety: { label: 'کمینه‌سازی کسری نقدینگی', hint: 'کمترین حداکثر حفرهٔ نقدینگی (حالت محافظه‌کارانه)' },
};

export interface Constraints {
  /** حداکثر کسری مجاز به درصد منابع ورودی خالص — صفر یعنی بدون محدودیت */
  maxHolePct: number;
  /** نقطهٔ واژگونی در افق مجاز نباشد */
  requireSolvent: boolean;
  /** سقف اهرم خروج — صفر یعنی بدون محدودیت */
  maxLeverage: number;
  /** حاشیهٔ خالص دست‌کم صفر باشد */
  requirePositiveMargin: boolean;
}

/**
 * سقف پیش‌فرض حفرهٔ نقدینگی.
 *
 * عدد ۱۰٪ که پیش‌تر اینجا بود با فرض‌های رفتاری پیش‌فرض (ω_with = ۹۰٪ روی
 * ۸۰٪ متقاضی + ω_churn = ۵۰٪) دست‌یافتنی نیست: خروج همزمان سپرده و تعهد
 * وام، حتی با کوچک‌ترین ضریب برابری، کسری‌ای بزرگ‌تر از ۱۰٪ منابع خالص
 * می‌سازد. نتیجه این بود که «هیچ طرح موجهی» پیدا نمی‌شد و کل منطق قیدها
 * عملاً از کار می‌افتاد. ۴۵٪ برای هر دو الگوی نمونه دست‌یافتنی است و
 * همچنان قیدِ معنا داری باقی می‌ماند.
 */
export const DEFAULT_CONSTRAINTS: Constraints = {
  maxHolePct: 45,
  requireSolvent: false,
  maxLeverage: 0,
  requirePositiveMargin: false,
};

export const leverKey = (l: DesignLevers): string =>
  `${Math.round(finite(l.alphaScale, 100) * 100) / 100}|${Math.round(finite(l.tDepShift, 0))}|${Math.round(
    finite(l.tLoanShift, 0),
  )}`;

/**
 * نقاط شروع قطعی جست‌وجوی چندشروعی: طرح جاری + کران بالا و پایین هر
 * اهرم (به‌تنهایی). چون نقطهٔ شروع اول همان طرح جاری است، نتیجهٔ
 * چندشروعی هرگز از تک‌شروعی بدتر نمی‌شود.
 */
export const MULTI_STARTS: DesignLevers[] = [
  NEUTRAL_LEVERS,
  { ...NEUTRAL_LEVERS, alphaScale: 75 },
  { ...NEUTRAL_LEVERS, alphaScale: 125 },
  { ...NEUTRAL_LEVERS, tDepShift: -3 },
  { ...NEUTRAL_LEVERS, tDepShift: 3 },
  { ...NEUTRAL_LEVERS, tLoanShift: -24 },
  { ...NEUTRAL_LEVERS, tLoanShift: 24 },
];

/** فاصله از طراحی پایه — برای شکستن تساوی تا موتور بی‌دلیل طرح را تغییر ندهد */
export function leverDistance(l: DesignLevers): number {
  return (
    Math.abs(finite(l.alphaScale, 100) - 100) / 100 +
    Math.abs(finite(l.tDepShift, 0)) / 3 +
    Math.abs(finite(l.tLoanShift, 0)) / 12
  );
}

const r3 = (v: unknown): number => Math.round(finite(v, 0) * 1000) / 1000;

/**
 * اثر انگشت «طراحی واقعی» یعنی خودِ پله‌ها، نه ترکیب اهرم‌ها.
 *
 * اهرم‌ها پس از مهار شدن در کران‌های قانونی، اغلب به پله‌های یکسانی می‌رسند
 * (مثلاً tDep = ۱۲ با هر جابه‌جایی مثبت، یا tLoan وقتی همه به سقف ۶۰ چسبیده‌اند).
 * بدون این اثر انگشت، فهرست نامزدها پر از ردیف‌هایی می‌شد که طراحی یکسانی
 * دارند و فقط برچسب اهرم‌شان فرق می‌کند.
 */
export function designFingerprint(tiers: Tier[]): string {
  return tiers
    .map((t) =>
      [
        r3(t.tDep),
        r3(t.tLoan),
        r3(t.alpha),
        r3(t.allocation),
        r3(t.minBalance),
        t.rateOverride === null || t.rateOverride === undefined ? 'g' : r3(t.rateOverride),
      ].join(','),
    )
    .join(';');
}

/** قواعد دامنهٔ جست‌وجو؛ خروجی بهینه‌یاب باید همواره در جدول جاری قابل انتخاب باشد. */
interface DesignRules {
  waitMin: number;
  waitMax: number;
  alphaMin: number;
  alphaMax: number;
  repaymentTerms: number[];
}

function rulesFor(input?: SimInput): DesignRules {
  if (input?.config.contractType === 'qard') {
    return { waitMin: 1, waitMax: 18, alphaMin: 2.5, alphaMax: 225, repaymentTerms: [12, 24, 36, 48, 60] };
  }
  const tiers = input?.tiers ?? [];
  const terms = [...new Set(tiers.map((t) => Math.round(finite(t.tLoan, 0))).filter((v) => v >= 6 && v <= 60))].sort((a, b) => a - b);
  return {
    waitMin: tiers.length ? Math.max(TIER_WAIT_MIN, Math.min(...tiers.map((t) => finite(t.tDep, TIER_WAIT_MIN)))) : TIER_WAIT_MIN,
    waitMax: tiers.length ? Math.min(TIER_WAIT_MAX, Math.max(...tiers.map((t) => finite(t.tDep, TIER_WAIT_MAX)))) : TIER_WAIT_MAX,
    alphaMin: tiers.length ? Math.max(TIER_ALPHA_MIN, Math.min(...tiers.map((t) => finite(t.alpha, TIER_ALPHA_MIN)))) : TIER_ALPHA_MIN,
    alphaMax: tiers.length ? Math.min(TIER_ALPHA_MAX, Math.max(...tiers.map((t) => finite(t.alpha, TIER_ALPHA_MAX)))) : TIER_ALPHA_MAX,
    repaymentTerms: terms.length ? terms : [12, 24, 36, 48, 60],
  };
}

function nearestTerm(value: number, terms: number[]): number {
  return terms.reduce((best, term) => (Math.abs(term - value) < Math.abs(best - value) ? term : best), terms[0]);
}

/**
 * فقط سه اهرم مجاز را اعمال می‌کند. نرخ اختصاصی، سهم تخصیص، حداقل مانده و
 * شناسهٔ هر حالت عیناً حفظ می‌شوند. دورهٔ بازپرداخت نیز به نزدیک‌ترین گزینهٔ
 * واقعی همان محصول نگاشت می‌شود تا خروجی‌های غیرعادی مثل ۱۸ یا ۳۰ ماه ساخته نشود.
 */
export function applyLevers(tiers: Tier[], l: DesignLevers, rules: DesignRules = rulesFor()): Tier[] {
  const list = Array.isArray(tiers) ? tiers.filter((t) => !!t) : [];
  const scale = bounded(l.alphaScale, 0, 1e6, 100) / 100;
  const depShift = Math.round(finite(l.tDepShift, 0));
  const loanShift = Math.round(finite(l.tLoanShift, 0));

  return list.map((t) => ({
    ...t,
    alpha: bounded(Math.max(0, finite(t.alpha, rules.alphaMin)) * scale, rules.alphaMin, rules.alphaMax, rules.alphaMin),
    tDep: bounded(finite(t.tDep, rules.waitMin) + depShift, rules.waitMin, rules.waitMax, rules.waitMin),
    tLoan: nearestTerm(finite(t.tLoan, rules.repaymentTerms[0]) + loanShift, rules.repaymentTerms),
  }));
}

export function objectiveValue(k: SimKpis, objective: Objective): number {
  switch (objective) {
    case 'margin':
      return Number.isFinite(k.netMargin) ? k.netMargin : -Infinity;
    case 'income':
      return k.totalIncomeInHorizon;
    case 'volume':
      return k.totalCommitment;
    case 'safety':
      return -k.maxHole;
  }
}

export function violations(k: SimKpis, c: Constraints): string[] {
  const out: string[] = [];
  if (c.maxHolePct > 0 && k.netDeposit > 0 && (k.maxHole / k.netDeposit) * 100 > c.maxHolePct) {
    out.push(`حفرهٔ نقدینگی ${fmtPct((k.maxHole / k.netDeposit) * 100, 1)} > سقف ${fmtPct(c.maxHolePct, 1)}`);
  }
  if (c.requireSolvent && k.tippingPoint !== null) out.push(`واژگونی در ماه ${toFa(k.tippingPoint)}`);
  if (c.maxLeverage > 0 && k.leverage > c.maxLeverage) {
    out.push(`اهرم ${fmtRatio(k.leverage)}× > سقف ${fmtNumber(c.maxLeverage, 2, true)}×`);
  }
  if (c.requirePositiveMargin && k.netMargin < -EPS) out.push('حاشیهٔ خالص منفی');
  return out;
}

/**
 * شدت نقض قیدها — یک عدد بی‌مقیاس که «چقدر ناموجه» را اندازه می‌گیرد.
 *
 * بدون این سنجه، وقتی هیچ طرحی موجه نبود رتبه‌بندی عملاً به بیشینه‌سازی
 * صرف عدد هدف فرو می‌کاست و موتور طرحی را «بهینه» می‌نامید که حفرهٔ
 * نقدینگی‌اش چند برابر طرح جاری بود. هر جزء نسبت به سقف خودش نرمال می‌شود
 * تا قیدهای با مقیاس متفاوت (درصد، نسبت، تومان) قابل جمع باشند.
 */
export function violationSeverity(k: SimKpis, c: Constraints): number {
  let s = 0;
  const net = k.netDeposit > EPS ? k.netDeposit : 0;
  if (c.maxHolePct > 0 && net > 0) {
    const holePct = (k.maxHole / net) * 100;
    if (holePct > c.maxHolePct) s += (holePct - c.maxHolePct) / c.maxHolePct;
  }
  if (c.requireSolvent && k.tippingPoint !== null) {
    // یک واحد پایه برای خودِ واژگونی + عمق نسبی کسری
    s += 1 + (net > 0 ? k.maxHole / net : 0);
  }
  if (c.maxLeverage > 0 && k.leverage > c.maxLeverage) {
    s += Number.isFinite(k.leverage) ? (k.leverage - c.maxLeverage) / c.maxLeverage : 1e6;
  }
  if (c.requirePositiveMargin && k.netMargin < -EPS) {
    s += net > 0 ? -k.netMargin / net : 1;
  }
  return Number.isFinite(s) ? s : 1e9;
}

export interface CandidateDesign {
  levers: DesignLevers;
  key: string;
  /** اثر انگشت طراحی واقعی — کلید یکتای فهرست نامزدها */
  fingerprint: string;
  kpis: SimKpis;
  objective: number;
  feasible: boolean;
  violations: string[];
  /** شدت نقض قیدها؛ صفر یعنی موجه */
  severity: number;
  distance: number;
}

export interface OptimizationResult {
  baseline: CandidateDesign;
  best: CandidateDesign;
  /** بهترین طرح‌های موجه (یا کم‌نقض‌ترین‌ها اگر هیچ‌کدام موجه نبود) */
  candidates: CandidateDesign[];
  /** تعداد طراحی‌های «متمایز» ارزیابی‌شده (پس از حذف طراحی‌های همسان) */
  evaluations: number;
  /** تعداد ترکیب اهرم ارزیابی‌شده پیش از حذف همسان‌ها */
  probes: number;
  elapsedMs: number;
  passes: number;
  /** تعداد نقاط شروعی که جست‌وجو از آن‌ها انجام شد */
  starts: number;
  improved: boolean;
  anyFeasible: boolean;
}

/** مقایسهٔ امن دو عدد هدف که می‌تواند ±بی‌نهایت یا NaN باشد */
function objectiveDiffers(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (a === b) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function evaluateWith(
  input: SimInput,
  tiers: Tier[],
  levers: DesignLevers,
  fingerprint: string,
  objective: Objective,
  c: Constraints,
): CandidateDesign {
  const kpis = simulate({ ...input, tiers }, false).kpis;
  const v = violations(kpis, c);
  return {
    levers,
    key: leverKey(levers),
    fingerprint,
    kpis,
    objective: objectiveValue(kpis, objective),
    feasible: v.length === 0,
    violations: v,
    severity: violationSeverity(kpis, c),
    distance: leverDistance(levers),
  };
}

/**
 * سنجه‌های فرعی برای شکستن تساویِ مقدار هدف.
 *
 * برخی هدف‌ها ذاتاً به بخشی از اهرم‌ها حساس نیستند — مثلاً «حجم تسهیلات»
 * فقط به ضریب برابری و سهم تخصیص بستگی دارد و با جابه‌جایی دورهٔ انتظار،
 * بازپرداخت یا نرخ عوض نمی‌شود. بدون سنجهٔ فرعی، چندین طراحی کاملاً متفاوت
 * روی یک عدد هدف گره می‌خوردند و رتبهٔ اول صرفاً نزدیک‌ترین به طرح جاری
 * می‌شد، حتی اگر پرریسک‌ترینشان بود. حالا تساوی به سمت طراحی کم‌ریسک‌تر
 * و سودآورتر شکسته می‌شود.
 */
function tieBreakDiffers(a: CandidateDesign, b: CandidateDesign): boolean {
  if (Math.abs(a.kpis.maxHole - b.kpis.maxHole) > 1e-6) return a.kpis.maxHole < b.kpis.maxHole;
  if (Math.abs(a.kpis.netMargin - b.kpis.netMargin) > 1e-6) return a.kpis.netMargin > b.kpis.netMargin;
  return false;
}

/**
 * ترتیب اولویت:
 *   ۱) موجه بودن (اولویت مطلق)
 *   ۲) میان ناموجه‌ها: شدت نقض کمتر
 *   ۳) مقدار هدف بیشتر
 *   ۴) شدت نقض کمتر (در حالت موجه همه صفرند، پس بی‌اثر است)
 *   ۵) سنجه‌های فرعی: حفرهٔ نقدینگی کمتر، سپس حاشیهٔ خالص بیشتر
 *   ۶) فاصلهٔ کمتر از طرح جاری — تا موتور بی‌دلیل پله‌ها را تغییر ندهد
 */
function better(a: CandidateDesign, b: CandidateDesign): boolean {
  if (a.feasible !== b.feasible) return a.feasible;
  if (!a.feasible && Math.abs(a.severity - b.severity) > 1e-12) return a.severity < b.severity;
  if (objectiveDiffers(a.objective, b.objective)) return a.objective > b.objective;
  if (Math.abs(a.severity - b.severity) > 1e-12) return a.severity < b.severity;
  if (tieBreakDiffers(a, b)) return true;
  if (tieBreakDiffers(b, a)) return false;
  return a.distance < b.distance;
}

const byPriority = (a: CandidateDesign, b: CandidateDesign): number => (better(a, b) ? -1 : better(b, a) ? 1 : 0);

export interface OptimizeOptions {
  objective: Objective;
  constraints: Constraints;
  passes?: number;
  topN?: number;
  /** جست‌وجو از چند نقطهٔ شروع (پیش‌فرض: فعال)؛ false یعنی همان تک‌شروع از طرح جاری */
  multiStart?: boolean;
}

export function optimizeDesign(input: SimInput, opts: OptimizeOptions): OptimizationResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const passes = Math.max(1, Math.round(finite(opts.passes, 2)));
  const topN = Math.max(1, Math.round(finite(opts.topN, 6)));
  const { objective, constraints } = opts;
  const starts = opts.multiStart === false ? [NEUTRAL_LEVERS] : MULTI_STARTS;
  const rules = rulesFor(input);

  const byLever = new Map<string, CandidateDesign>();
  const byDesign = new Map<string, CandidateDesign>();

  const evalLevers = (l: DesignLevers): CandidateDesign => {
    const key = leverKey(l);
    const hit = byLever.get(key);
    if (hit) return hit;
    const tiers = applyLevers(input.tiers, l, rules);
    const fingerprint = designFingerprint(tiers);
    // ترکیب‌های اهرمی که به پله‌های یکسان می‌رسند فقط یک‌بار شبیه‌سازی می‌شوند
    // و در فهرست نامزدها هم یک ردیف بیشتر اشغال نمی‌کنند.
    const dup = byDesign.get(fingerprint);
    const c = dup ?? evaluateWith(input, tiers, l, fingerprint, objective, constraints);
    byLever.set(key, c);
    if (!dup) byDesign.set(fingerprint, c);
    return c;
  };

  const baseline = evalLevers(NEUTRAL_LEVERS);
  let current = baseline;
  let usedPasses = 0;

  for (const start of starts) {
    let cursor = evalLevers(start);
    for (let pass = 0; pass < passes; pass++) {
      usedPasses = Math.max(usedPasses, pass + 1);
      let improvedThisPass = false;
      for (const dim of ['alphaScale', 'tDepShift', 'tLoanShift'] as const) {
        let best = cursor;
        for (const v of LEVER_GRID[dim]) {
          const cand = evalLevers({ ...cursor.levers, [dim]: v });
          if (better(cand, best)) best = cand;
        }
        if (best.fingerprint !== cursor.fingerprint) {
          cursor = best;
          improvedThisPass = true;
        }
      }
      if (!improvedThisPass) break;
    }
    if (better(cursor, current)) current = cursor;
  }

  const all = [...byDesign.values()];
  const anyFeasible = all.some((c) => c.feasible);
  const candidates = all.slice().sort(byPriority).slice(0, topN);

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
  return {
    baseline,
    best: current,
    candidates,
    evaluations: byDesign.size,
    probes: byLever.size,
    elapsedMs,
    passes: usedPasses,
    starts: starts.length,
    improved: current.fingerprint !== baseline.fingerprint,
    anyFeasible,
  };
}

/** شرح فارسی اهرم‌ها برای نمایش در جدول */
export function describeLevers(l: DesignLevers): string[] {
  const out: string[] = [];
  const a = finite(l.alphaScale, 100);
  if (Math.abs(a - 100) > 0.01) out.push(`ضرایب برابری ×${fmtNumber(a / 100, 2, true)}`);
  const d = Math.round(finite(l.tDepShift, 0));
  if (d !== 0) out.push(`دورهٔ انتظار ${d > 0 ? '+' : '−'}${fmtNumber(Math.abs(d))} ماه`);
  const t = Math.round(finite(l.tLoanShift, 0));
  if (t !== 0) out.push(`بازپرداخت ${t > 0 ? '+' : '−'}${fmtNumber(Math.abs(t))} ماه`);
  return out.length ? out : ['بدون تغییر (طرح جاری)'];
}

/** اعمال سه اهرم مجاز با قواعد دوره و دامنهٔ محصول جاری */
export function designTiers(input: SimInput, levers: DesignLevers): Tier[] {
  return applyLevers(input.tiers, levers, rulesFor(input));
}

/** ورودی به‌روز‌شده پس از اعمال یک طرح — برای «اعمال» در یک کلیک */
export function designToInput(input: SimInput, levers: DesignLevers): SimInput {
  return { ...input, tiers: designTiers(input, levers) };
}

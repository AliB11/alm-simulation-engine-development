/* ------------------------------------------------------------------ *
 *  DESIGN OPTIMIZER — «طراح معکوس»
 *
 *  کاربر هدف و قیدها را تعیین می‌کند و موتور با جست‌وجوی مختصاتی
 *  (Coordinate Descent) روی چهار اهرم طراحی، بهترین ترکیب را می‌یابد:
 *     1) alphaScale  — مقیاس ضرایب برابری (حجم تسهیلات)
 *     2) tDepShift   — جابه‌جایی دورهٔ انتظار همهٔ پله‌ها (زمان‌بندی خروج)
 *     3) tLoanShift  — جابه‌جازی دورهٔ بازپرداخت (زمان‌بندی ورود اقساط)
 *     4) tilt        — کج‌کردن سهم تخصیص به سمت پله‌های با انتظار بلند/کوتاه
 *
 *  در هر اجرا همهٔ اهرم‌ها یک‌جا روی پله‌های ورودی اعمال می‌شوند (نه
 *  تجمعی در حلقهٔ جست‌وجو)، پس نتیجه کاملاً قطعی و بازتولیدپذیر است.
 * ------------------------------------------------------------------ */

import type { SimInput, SimKpis, Tier } from '../types';
import { bounded, finite, simulate } from './engine';
import { TIER_ALPHA_MAX } from './limits';
import { fmtNumber, fmtPct, fmtRatio, toFa } from './format';

export type Objective = 'margin' | 'income' | 'volume' | 'safety';
export type AllocationTilt = 'none' | 'longWait' | 'shortWait';

export interface DesignLevers {
  /** درصد — ۱۰۰ یعنی بدون تغییر */
  alphaScale: number;
  /** ماه — منفی یعنی انتظار کوتاه‌تر */
  tDepShift: number;
  /** ماه — منفی یعنی بازپرداخت کوتاه‌تر */
  tLoanShift: number;
  tilt: AllocationTilt;
}

export const NEUTRAL_LEVERS: DesignLevers = { alphaScale: 100, tDepShift: 0, tLoanShift: 0, tilt: 'none' };

export const LEVER_GRID = {
  alphaScale: [60, 75, 90, 100, 110, 125, 150, 175, 200],
  tDepShift: [-3, -2, -1, 0, 1, 2, 3, 4, 6],
  tLoanShift: [-18, -12, -6, 0, 6, 12, 18, 24],
  tilt: ['none', 'longWait', 'shortWait'] as AllocationTilt[],
};

export const OBJECTIVE_LABELS: Record<Objective, { label: string; hint: string }> = {
  margin: { label: 'حاشیهٔ خالص بانک', hint: 'بیشینه‌سازی درآمد منهای سود سپرده و هزینهٔ تأمین کسری' },
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

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxHolePct: 10,
  requireSolvent: false,
  maxLeverage: 0,
  requirePositiveMargin: true,
};

export const leverKey = (l: DesignLevers): string =>
  `${Math.round(l.alphaScale * 100) / 100}|${Math.round(l.tDepShift)}|${Math.round(l.tLoanShift)}|${l.tilt}`;

/** فاصله از طراحی پایه — برای شکستن تساوی تا موتور بی‌دلیل طرح را تغییر ندهد */
export function leverDistance(l: DesignLevers): number {
  return (
    Math.abs(finite(l.alphaScale, 100) - 100) / 100 +
    Math.abs(finite(l.tDepShift, 0)) / 3 +
    Math.abs(finite(l.tLoanShift, 0)) / 12 +
    (l.tilt === 'none' ? 0 : 1)
  );
}

export function applyLevers(tiers: Tier[], l: DesignLevers): Tier[] {
  const list = Array.isArray(tiers) ? tiers.filter((t) => !!t) : [];
  const scale = bounded(l.alphaScale, 0, 1e6, 100) / 100;
  const depShift = Math.round(finite(l.tDepShift, 0));
  const loanShift = Math.round(finite(l.tLoanShift, 0));

  // اهرم‌ها روی یک نسخهٔ پاک‌سازی‌شده اعمال می‌شوند تا خروجی بهینه‌یاب
  // هرگز مقدار NaN یا منفی را به وضعیت برنامه برنگرداند.
  const base = list.map((t) => ({
    ...t,
    // سقف همان سقف سازندهٔ پله است تا «اعمال» طرحی نسازد که کاربر نتواند ویرایش یا ذخیره کند
    alpha: bounded(Math.max(0, finite(t.alpha, 0)) * scale, 0, TIER_ALPHA_MAX, 0),
    tDep: bounded(t.tDep + depShift, 1, 12, 1),
    tLoan: bounded(t.tLoan + loanShift, 6, 60, 12),
    allocation: Math.max(0, finite(t.allocation, 0)),
    minBalance: Math.max(0, finite(t.minBalance, 0)),
    rateOverride: t.rateOverride === null || t.rateOverride === undefined ? null : bounded(t.rateOverride, 0, 1000, 0),
  }));

  if (l.tilt === 'none') return base;

  const total = base.reduce((s, t) => s + t.allocation, 0);
  if (!(total > 0)) return base;
  // وزن‌دهی بر پایهٔ دورهٔ انتظار، با حفظ مجموع سهم‌ها (بدون تغییر کل منابع تخصیصی)
  const weight = (t: Tier) => {
    const dep = bounded(t.tDep, 1, 12, 1);
    return l.tilt === 'longWait' ? 0.5 + dep / 12 : 0.5 + (13 - dep) / 12;
  };
  const wSum = base.reduce((s, t) => s + t.allocation * weight(t), 0);
  if (!(wSum > 0)) return base;
  const raw = base.map((t) => (t.allocation * weight(t) * total) / wSum);
  // گرد کردن به دو رقم اعشار و بازگرداندن خطای گردکردن به بزرگ‌ترین سهم، تا جمع دقیقاً حفظ شود
  const rounded = raw.map((v) => Math.round(v * 100) / 100);
  const drift = total - rounded.reduce((s, v) => s + v, 0);
  if (Math.abs(drift) > 1e-9) {
    let idx = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[idx]) idx = i;
    rounded[idx] = Math.max(0, rounded[idx] + drift);
  }
  return base.map((t, i) => ({ ...t, allocation: rounded[i] }));
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
  if (c.requirePositiveMargin && k.netMargin < 0) out.push('حاشیهٔ خالص منفی');
  return out;
}

export interface CandidateDesign {
  levers: DesignLevers;
  key: string;
  kpis: SimKpis;
  objective: number;
  feasible: boolean;
  violations: string[];
  distance: number;
}

export interface OptimizationResult {
  baseline: CandidateDesign;
  best: CandidateDesign;
  /** بهترین طرح‌های موجه (یا کم‌نقض‌ترین‌ها اگر هیچ‌کدام موجه نبود) */
  candidates: CandidateDesign[];
  evaluations: number;
  elapsedMs: number;
  passes: number;
  improved: boolean;
  anyFeasible: boolean;
}

function evaluate(input: SimInput, levers: DesignLevers, objective: Objective, c: Constraints): CandidateDesign {
  const tiers = applyLevers(input.tiers, levers);
  const kpis = simulate({ ...input, tiers }, false).kpis;
  const v = violations(kpis, c);
  return {
    levers,
    key: leverKey(levers),
    kpis,
    objective: objectiveValue(kpis, objective),
    feasible: v.length === 0,
    violations: v,
    distance: leverDistance(levers),
  };
}

/** موجه بودن اولویت مطلق دارد؛ سپس مقدار هدف؛ و در تساوی، طرح نزدیک‌تر به پایه */
function better(a: CandidateDesign, b: CandidateDesign): boolean {
  if (a.feasible !== b.feasible) return a.feasible;
  if (Math.abs(a.objective - b.objective) > 1e-9) return a.objective > b.objective;
  if (a.violations.length !== b.violations.length) return a.violations.length < b.violations.length;
  return a.distance < b.distance;
}

export interface OptimizeOptions {
  objective: Objective;
  constraints: Constraints;
  passes?: number;
  topN?: number;
}

export function optimizeDesign(input: SimInput, opts: OptimizeOptions): OptimizationResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const passes = Math.max(1, Math.round(finite(opts.passes, 2)));
  const topN = Math.max(1, Math.round(finite(opts.topN, 6)));
  const { objective, constraints } = opts;

  const pool = new Map<string, CandidateDesign>();
  const evalLevers = (l: DesignLevers): CandidateDesign => {
    const key = leverKey(l);
    const hit = pool.get(key);
    if (hit) return hit;
    const c = evaluate(input, l, objective, constraints);
    pool.set(key, c);
    return c;
  };

  const baseline = evalLevers(NEUTRAL_LEVERS);
  let current = baseline;
  let usedPasses = 0;

  for (let pass = 0; pass < passes; pass++) {
    usedPasses = pass + 1;
    let improvedThisPass = false;
    for (const dim of ['alphaScale', 'tDepShift', 'tLoanShift', 'tilt'] as const) {
      let best = current;
      for (const v of LEVER_GRID[dim]) {
        const cand = evalLevers({ ...current.levers, [dim]: v });
        if (better(cand, best)) best = cand;
      }
      if (best.key !== current.key) {
        current = best;
        improvedThisPass = true;
      }
    }
    if (!improvedThisPass) break;
  }

  const all = [...pool.values()];
  const anyFeasible = all.some((c) => c.feasible);
  const candidates = all
    .slice()
    .sort((a, b) => {
      if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
      if (Math.abs(a.objective - b.objective) > 1e-9) return a.objective > b.objective ? -1 : 1;
      if (a.violations.length !== b.violations.length) return a.violations.length - b.violations.length;
      return a.distance - b.distance;
    })
    .slice(0, topN);

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
  return {
    baseline,
    best: current,
    candidates,
    evaluations: pool.size,
    elapsedMs,
    passes: usedPasses,
    improved: current.key !== baseline.key,
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
  if (l.tilt === 'longWait') out.push('سهم بیشتر به پله‌های با انتظار بلند');
  if (l.tilt === 'shortWait') out.push('سهم بیشتر به پله‌های با انتظار کوتاه');
  return out.length ? out : ['بدون تغییر (طرح جاری)'];
}

/** ورودی به‌روز‌شده پس از اعمال یک طرح — برای «اعمال» در یک کلیک */
export function designToInput(input: SimInput, levers: DesignLevers): SimInput {
  return { ...input, tiers: applyLevers(input.tiers, levers) };
}

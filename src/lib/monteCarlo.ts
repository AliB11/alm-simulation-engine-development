/* ------------------------------------------------------------------ *
 *  MONTE CARLO ENGINE — آزمون بحران احتمالاتی
 *
 *  به‌جای یک سناریوی قطعی، ورودی‌های رفتاری و حجم منابع از توزیع‌های
 *  آماری حول برآورد کاربر نمونه‌گیری می‌شوند و N شبیه‌سازی کامل اجرا
 *  می‌گردد. خروجی، توزیع ریسک است نه یک عدد:
 *     P(واژگونی در افق) ، چک‌های P5/P50/P95/P99 ، بدترین و بهترین اجرا
 *
 *  تولید اعداد تصادفی با mulberry32 + روش قطبی مارسالیا انجام می‌شود و
 *  «دانه» (seed) قابل تنظیم است تا هر نتیجه دقیقاً بازتولیدپذیر باشد.
 * ------------------------------------------------------------------ */

import type { Behavior, DepositSchedule, GlobalConfig, SimInput, SimKpis } from '../types';
import { bounded, buildVintages, finite, lastMatrixMonth, simulate } from './engine';

/* ------------------------- تولید اعداد تصادفی ------------------------- */

export function mulberry32(seed: number): () => number {
  let a = Math.abs(Math.round(finite(seed, 1))) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** نمونه‌گیر نرمال استاندارد N(0,1) — روش قطبی مارسالیا (بدون مثلثات) */
export function makeGaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return function gaussian() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

/* ------------------------------ پیکربندی ------------------------------ */

export type StochasticKey =
  | 'takeUpRate'
  | 'approvalRate'
  | 'runoffRate'
  | 'churnRate'
  | 'totalDeposit'
  | 'defaultRate'
  | 'timing';

export const STOCHASTIC_LABELS: Record<StochasticKey, { label: string; symbol: string }> = {
  takeUpRate: { label: 'نرخ تقاضای وام', symbol: 'ρ_take' },
  approvalRate: { label: 'نرخ قبولی اعتباری', symbol: 'ρ_app' },
  runoffRate: { label: 'خروج سپرده وام‌گیرندگان', symbol: 'ω_with' },
  churnRate: { label: 'خروج انصراف‌دهندگان', symbol: 'ω_churn' },
  totalDeposit: { label: 'حجم منابع جذب‌شده', symbol: 'D' },
  defaultRate: { label: 'نرخ نکول اقساط', symbol: 'δ' },
  timing: { label: 'زمان‌بندی ورود منابع', symbol: 'Δt' },
};

export interface McOptions {
  runs: number;
  seed: number;
  /** شدت عدم قطعیت (درصد) — ۰ یعنی اجراهای کاملاً قطعی */
  intensity: number;
  stochastic: Record<StochasticKey, boolean>;
}

export const DEFAULT_MC: McOptions = {
  runs: 200,
  seed: 1403,
  intensity: 40,
  stochastic: {
    takeUpRate: true,
    approvalRate: true,
    runoffRate: true,
    churnRate: true,
    totalDeposit: true,
    defaultRate: true,
    timing: true,
  },
};

export interface Perturbation {
  takeUpRate: number;
  approvalRate: number;
  runoffRate: number;
  churnRate: number;
  totalDeposit: number;
  defaultRate: number;
  timingShift: number;
}

/* --------------------------- اختلال ورودی‌ها --------------------------- */

/**
 * زمان‌بندی منابع را به‌صورت یک «شوک تأخیر/تعجیل سیستمی» جابه‌جا می‌کند.
 * با تبدیل هر حالت (یکجا/یکنواخت/سفارشی) به ویژه‌های معادل و سپس جابه‌جایی
 * ماه‌ها، این تابع برای هر سه حالت یکسان کار می‌کند.
 */
export function shiftedSchedule(input: SimInput, shift: number): DepositSchedule {
  const s = Math.round(finite(shift, 0));
  if (s === 0) return input.schedule;
  const H = Math.round(bounded(input.config.horizon, 1, 600, 60));
  const lastMonth = lastMatrixMonth(H);
  const vintages = buildVintages(bounded(input.behavior.totalDeposit, 0, 1e18, 0), input.schedule, H);
  if (!vintages.length) return input.schedule;
  const total = vintages.reduce((sum, v) => sum + v.amount, 0);
  if (!(total > 0)) return input.schedule;
  return {
    mode: 'custom',
    uniformMonths: input.schedule.uniformMonths,
    custom: vintages.map((v, i) => ({
      id: `mc-${i}`,
      // مهار در بازهٔ افق تا جابه‌جایی زمان، حجم منابع را از بین نبرد
      month: Math.min(lastMonth, Math.max(0, v.month + s)),
      share: (v.amount / total) * 100,
    })),
  };
}

export function perturbInput(
  input: SimInput,
  o: McOptions,
  gauss: () => number,
): { input: SimInput; perturbation: Perturbation } {
  const k = bounded(o.intensity, 0, 100, 0) / 100;
  const sigmaPct = k * 20; // واحد: درصد (مثلاً شدت ۵۰٪ ⇒ σ = ۱۰ واحد درصد)
  const sigmaLog = k * 0.25; // انحراف معیار لگاریتمی حجم منابع
  const b = input.behavior;
  const c = input.config;

  const rate = (value: number, on: boolean) => bounded(on ? value + gauss() * sigmaPct : value, 0, 100, 0);

  const timingRaw = o.stochastic.timing ? Math.round(gauss() * k * 1.5) : 0;

  const perturbation: Perturbation = {
    takeUpRate: rate(b.takeUpRate, o.stochastic.takeUpRate),
    approvalRate: rate(b.approvalRate, o.stochastic.approvalRate),
    runoffRate: rate(b.runoffRate, o.stochastic.runoffRate),
    churnRate: rate(b.churnRate, o.stochastic.churnRate),
    totalDeposit: o.stochastic.totalDeposit
      ? Math.max(0, bounded(b.totalDeposit, 0, 1e18, 0) * Math.exp(gauss() * sigmaLog))
      : bounded(b.totalDeposit, 0, 1e18, 0),
    defaultRate: rate(c.defaultRate, o.stochastic.defaultRate),
    // `-0 === 0` است، پس این مقایسه منفی‌صفر را از خروجی حذف می‌کند
    timingShift: timingRaw === 0 ? 0 : timingRaw,
  };

  const behavior: Behavior = {
    ...b,
    takeUpRate: perturbation.takeUpRate,
    approvalRate: perturbation.approvalRate,
    runoffRate: perturbation.runoffRate,
    churnRate: perturbation.churnRate,
    totalDeposit: perturbation.totalDeposit,
  };
  const config: GlobalConfig = { ...c, defaultRate: perturbation.defaultRate };
  const schedule = shiftedSchedule({ ...input, behavior, config }, perturbation.timingShift);

  return { input: { ...input, behavior, config, schedule }, perturbation };
}

/* ------------------------------ اجرا و خلاصه ------------------------------ */

export interface McRun {
  kpis: SimKpis;
  perturbation: Perturbation;
  behavior: Behavior;
  config: GlobalConfig;
  schedule: DepositSchedule;
}

export interface McSample {
  maxHole: number;
  endCum: number;
  netMargin: number;
  leverage: number;
  tipping: number | null;
  interbankCost: number;
}

export interface PercentileSet {
  min: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface McSummary {
  runs: number;
  seed: number;
  intensity: number;
  elapsedMs: number;
  /** احتمال وقوع واژگونی نقدینگی در افق */
  pTipping: number;
  /** احتمال وجود هرگونه کسری تجمعی */
  pDeficit: number;
  /** احتمال زیان‌ده بودن طرح (حاشیهٔ خالص منفی) */
  pLoss: number;
  maxHole: PercentileSet;
  endCum: PercentileSet;
  netMargin: PercentileSet;
  leverage: PercentileSet;
  interbankCost: PercentileSet;
  samples: McSample[];
  worst: McRun | null;
  best: McRun | null;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((bounded(p, 0, 100, 50) / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(values: number[]): PercentileSet {
  const finiteValues = values.filter((v) => Number.isFinite(v));
  if (!finiteValues.length) {
    return { min: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const sorted = finiteValues.slice().sort((a, b) => a - b);
  return {
    min: sorted[0],
    p5: percentile(sorted, 5),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
  };
}

export function summarizeMc(runs: McRun[], o: McOptions, elapsedMs: number): McSummary {
  const n = runs.length;
  const samples: McSample[] = runs.map((r) => ({
    maxHole: r.kpis.maxHole,
    endCum: r.kpis.endCum,
    netMargin: r.kpis.netMargin,
    leverage: Number.isFinite(r.kpis.leverage) ? r.kpis.leverage : Number.MAX_VALUE,
    tipping: r.kpis.tippingPoint,
    interbankCost: r.kpis.interbankCost,
  }));

  let tipping = 0;
  let deficit = 0;
  let loss = 0;
  for (const r of runs) {
    if (r.kpis.tippingPoint !== null) tipping++;
    if (r.kpis.maxHole > 0) deficit++;
    if (r.kpis.netMargin < 0) loss++;
  }

  let worst: McRun | null = null;
  let best: McRun | null = null;
  for (const r of runs) {
    if (!worst || r.kpis.maxHole > worst.kpis.maxHole) worst = r;
    if (!best || r.kpis.maxHole < best.kpis.maxHole) best = r;
  }

  return {
    runs: n,
    seed: Math.round(finite(o.seed, 0)),
    intensity: bounded(o.intensity, 0, 100, 0),
    elapsedMs,
    pTipping: n ? tipping / n : 0,
    pDeficit: n ? deficit / n : 0,
    pLoss: n ? loss / n : 0,
    maxHole: stats(samples.map((s) => s.maxHole)),
    endCum: stats(samples.map((s) => s.endCum)),
    netMargin: stats(samples.map((s) => s.netMargin)),
    leverage: stats(samples.map((s) => s.leverage)),
    interbankCost: stats(samples.map((s) => s.interbankCost)),
    samples,
    worst,
    best,
  };
}

export interface McProgress {
  done: number;
  total: number;
}

/** اجرای تکه‌تکه تا رابط کاربری در اجراهای سنگین قفل نشود */
export async function runMonteCarlo(
  input: SimInput,
  o: McOptions,
  onProgress?: (p: McProgress) => void,
  shouldStop?: () => boolean,
): Promise<McSummary> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const total = Math.max(1, Math.round(bounded(o.runs, 1, 5000, 200)));
  const rng = mulberry32(o.seed);
  const gauss = makeGaussian(rng);
  const runs: McRun[] = [];
  const chunk = 10;

  for (let i = 0; i < total; i++) {
    if (shouldStop?.()) break;
    const perturbed = perturbInput(input, o, gauss);
    const kpis = simulate(perturbed.input, false).kpis;
    runs.push({
      kpis,
      perturbation: perturbed.perturbation,
      behavior: perturbed.input.behavior,
      config: perturbed.input.config,
      schedule: perturbed.input.schedule,
    });
    if ((i + 1) % chunk === 0) {
      onProgress?.({ done: i + 1, total });
      // واگذار کردن کنترل به حلقهٔ رویداد مرورگر
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.({ done: runs.length, total });
  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
  return summarizeMc(runs, o, elapsedMs);
}

/** هیستوگرام ساده برای رسم توزیع یک سنجه */
export function histogram(values: number[], bins = 14): { from: number; to: number; count: number }[] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [];
  const min = Math.min(...v);
  const max = Math.max(...v);
  if (max - min < 1e-12) return [{ from: min, to: max, count: v.length }];
  const width = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const x of v) {
    const idx = Math.min(bins - 1, Math.floor((x - min) / width));
    out[idx].count++;
  }
  return out;
}

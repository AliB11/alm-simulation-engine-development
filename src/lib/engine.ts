/* ------------------------------------------------------------------ *
 *  ALM SIMULATION ENGINE — Cohort / Vintage based cash-flow matrix
 *
 *  الف) استهلاک اقساط:
 *     قرض‌الحسنه:  PMT = (L / T) · (1 + r_f · T / 12)
 *     مرابحه:      PMT = L · r_m (1 + r_m)^T / ((1 + r_m)^T − 1) ,  r_m = r / 12
 *  ب) خروج همزمان (Double Liquidity Drain) در ماه سررسید T_dep:
 *     Commitment = D · α · ρ_take · ρ_app
 *     Withdrawal = D · [ρ_take · ω_with + (1 − ρ_take) · ω_churn]
 *     — اگر پله‌ای هیچ وامی اعطا نکند (حداقل مانده برآورده نشده یا α_eff = ۰)،
 *        وام‌گیرنده‌ای هم وجود ندارد؛ پس Withdrawal = D · ω_churn
 *  ج) ماتریس جریان وجوه:
 *     Inflows_t  = D_new,t · (1 − RR) + Σ PMT_k,t
 *     Outflows_t = Σ Commitment_k,t + Σ Withdrawal_k,t + Profit_t
 *     NCF_t = Inflows_t − Outflows_t ;  CumLiq_t = CumLiq_{t−1} + NCF_t
 *     Profit_t = میانگین ماندهٔ ماهانه × r_dep / 12 (ماه‌شمار، نه ماندهٔ پایان دوره)
 *  د) Tipping Point = اولین t با CumLiq_t < 0 ؛ Max Hole = −min(0, min_t CumLiq_t)
 *     Leverage = (Σ Commitment + Σ Withdrawal) / (D·(1−RR)) — اگر مخرج صفر و صورت مثبت باشد: ∞
 *  هـ) نکول: ذخیرهٔ زیان موردانتظار (L·δ·LGD) در ماه اعطا شناسایی و اصل
 *     وصول‌نشده پس از سررسید آخرین قسط + مهلت سوخت، از مانده تسهیلات
 *     خارج می‌شود. هر دو غیرنقدی‌اند: ذخیره فقط حاشیه و سوخت فقط مانده
 *     تسهیلات را کاهش می‌دهد؛ هیچ‌کدام وارد NCF/CumLiq نمی‌شوند.
 * ------------------------------------------------------------------ */

import type {
  Behavior,
  ContractType,
  DepositSchedule,
  EventType,
  FlowEvent,
  GlobalConfig,
  MonthRow,
  SimInput,
  SimKpis,
  SimResult,
  Tier,
  TierResult,
  Vintage,
} from '../types';
import { TIER_WAIT_MAX, TIER_WAIT_MIN } from './limits';

export const EPS = 1e-6;

/** کران‌های ایمن موتور — فقط برای جلوگیری از سرریز/NaN، نه محدودسازی ورودی کاربر */
export const MAX_RATE_PCT = 1000;
export const MAX_MONEY = 1e18;
export const MAX_MONTHS = 600;

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * دروازه ورود اعداد خام به موتور: هر مقدار غیرعدد، NaN یا ±Infinity به `fallback`
 * نگاشت می‌شود. بدون این لایه، یک فیلد خراب (مثلاً α = NaN) کل ماتریس نقدینگی و همه
 * شاخص‌ها را NaN می‌کند و داشبورد به‌جای هشدار، وضعیت «پایدار» نشان می‌دهد.
 */
export function finite(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** مانند finite ولی با محدودسازی به بازهٔ [lo, hi] و مقدار بازگشتی صریح */
export function bounded(v: unknown, lo: number, hi: number, fallback: number): number {
  return Math.min(hi, Math.max(lo, finite(v, fallback)));
}

export function globalRate(config: GlobalConfig): number {
  const r = config.contractType === 'qard' ? config.qardFeeRate : config.murabahaRate;
  return bounded(r, 0, MAX_RATE_PCT, 0);
}

export function tierRate(tier: Tier, config: GlobalConfig): number {
  const o = tier.rateOverride;
  return o === null || o === undefined || !Number.isFinite(o) ? globalRate(config) : bounded(o, 0, MAX_RATE_PCT, 0);
}

/* ---------------------------- الف) PMT ---------------------------- */

export function calcPmt(contract: ContractType, loan: number, months: number, annualRatePct: number): number {
  const L = finite(loan, 0);
  const n = finite(months, 0);
  if (!(L > 0) || !(n > 0)) return 0;
  const r = finite(annualRatePct, 0) / 100;
  if (contract === 'qard') {
    return (L / n) * (1 + (r * n) / 12);
  }
  const rm = r / 12;
  if (Math.abs(rm) < 1e-12) return L / n;
  const f = Math.pow(1 + rm, n);
  if (!Number.isFinite(f)) return L * rm; // حد f → ∞ (نرخ×مدت بسیار بزرگ): PMT ≈ L·r_m
  if (f === 1) return L / n;
  return (L * rm * f) / (f - 1);
}

export interface AmortRow {
  j: number;
  payment: number;
  principal: number;
  income: number;
  balance: number;
}

/** جدول استهلاک کامل (تفکیک اصل و کارمزد/سود هر قسط) */
export function amortization(contract: ContractType, loan: number, months: number, annualRatePct: number): AmortRow[] {
  const L = finite(loan, 0);
  const n = Math.max(0, Math.round(finite(months, 0)));
  const rate = finite(annualRatePct, 0);
  const pay = calcPmt(contract, L, n, rate);
  const rm = rate / 1200;
  const out: AmortRow[] = [];
  let bal = L;
  for (let j = 1; j <= n; j++) {
    let principal: number;
    let income: number;
    if (j === n) {
      // قسط پایانی دقیقاً به اندازه مانده است تا Σ اصل = L شود
      // (حذف خطای تجمعی ممیز شناور که مانده تسهیلات را از صفر دور می‌کرد)
      principal = bal;
      income = pay - principal;
    } else if (contract === 'qard' || Math.abs(rm) < 1e-12) {
      principal = L / n;
      income = pay - principal;
    } else {
      income = bal * rm;
      principal = pay - income;
    }
    bal = j === n ? 0 : Math.max(0, bal - principal);
    out.push({ j, payment: pay, principal, income, balance: bal });
  }
  return out;
}

/* ------------------- ضریب مؤثر با اعمال سقف فردی ------------------- */

export function representativeBalance(tier: Tier, avgTicket: number): number {
  return Math.max(bounded(avgTicket, 0, MAX_MONEY, 0), bounded(tier.minBalance, 0, MAX_MONEY, 0));
}

/**
 * α_eff = min(α , Cap / B_rep)   where B_rep = max(میانگین سپرده مشتری ، حداقل مانده پله)
 * اگر سقف فعال نباشد (Cap = 0) دقیقاً همان α فرمول پایه است.
 */
export function effectiveAlpha(
  tier: Tier,
  loanCap: number,
  avgTicket: number,
): { alpha: number; binding: boolean; repBalance: number } {
  const a = Math.max(0, finite(tier.alpha, 0)) / 100;
  const cap = bounded(loanCap, 0, MAX_MONEY, 0);
  const rep = representativeBalance(tier, avgTicket);
  if (cap > 0 && rep > 0 && cap / rep < a) {
    return { alpha: cap / rep, binding: true, repBalance: rep };
  }
  return { alpha: a, binding: false, repBalance: rep };
}

/* ------------------------ ضرایب رفتاری (ب) ------------------------ */

export function commitmentFactor(b: Behavior): number {
  return (clamp(b.takeUpRate, 0, 100) / 100) * (clamp(b.approvalRate, 0, 100) / 100);
}

export function withdrawalFactor(b: Behavior): number {
  const take = clamp(b.takeUpRate, 0, 100) / 100;
  return take * (clamp(b.runoffRate, 0, 100) / 100) + (1 - take) * (clamp(b.churnRate, 0, 100) / 100);
}

/**
 * ضریب خروج سپرده در سطح پله.
 * اگر پله هیچ وامی اعطا نکند (حداقل مانده پله برآورده نشده یا α_eff = ۰)، عملاً هیچ
 * «وام‌گیرنده»‌ای در آن پله وجود ندارد؛ پس همه سپرده‌گذاران انصراف‌دهنده فرض می‌شوند و
 * فقط ω_churn اعمال می‌گردد. در غیر این صورت همان فرمول پایه withdrawalFactor است.
 */
export function tierWithdrawalFactor(b: Behavior, lends: boolean): number {
  return lends ? withdrawalFactor(b) : clamp(b.churnRate, 0, 100) / 100;
}

/* ------------------------ ساخت ویژه‌های ورودی ------------------------ */

/** آخرین ماه قابل ثبت در ماتریس (t = 0 … lastMonth) */
export function lastMatrixMonth(horizon: number): number {
  return Math.round(bounded(horizon, 0, MAX_MONTHS, 0));
}

/**
 * تعداد ویژه‌های حالت «توزیع یکنواخت» — مرجع مشترک موتور و UI تا پیش‌نمایش ریالی
 * جدول زمان‌بندی هرگز از ماتریس واقعی واگرا نشود.
 */
export function uniformVintageCount(schedule: DepositSchedule, horizon: number): number {
  return Math.round(bounded(schedule.uniformMonths, 1, lastMatrixMonth(horizon) + 1, 1));
}

export function buildVintages(total: number, schedule: DepositSchedule, horizon: number): Vintage[] {
  const amount = finite(total, 0);
  if (!(amount > 0)) return [];
  const lastMonth = lastMatrixMonth(horizon);
  if (schedule.mode === 'lump') return [{ month: 0, amount }];
  if (schedule.mode === 'uniform') {
    const n = uniformVintageCount(schedule, horizon);
    return Array.from({ length: n }, (_, i) => ({ month: i, amount: amount / n }));
  }

  // Keep only valid in-horizon entries before normalization so dropped/invalid
  // entries cannot silently reduce the modeled deposit total.
  const valid = (Array.isArray(schedule.custom) ? schedule.custom : []).filter(
    (v) => !!v && Number.isFinite(v.month) && Number.isFinite(v.share) && v.share > 0,
  );
  const byMonth = new Map<number, number>();
  for (const v of valid) {
    const month = Math.round(v.month);
    if (month < 0 || month > lastMonth) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + v.share);
  }
  const sum = [...byMonth.values()].reduce((s, share) => s + share, 0);
  if (!(sum > 0)) return [];
  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, share]) => ({ month, amount: (amount * share) / sum }));
}

/* ----------------------- موتور ماتریس نقدینگی ----------------------- */

const EVENT_ORDER: Record<EventType, number> = {
  deposit: 0,
  reserve: 1,
  release: 2,
  pmt: 3,
  loan: 4,
  withdrawal: 5,
  profit: 6,
};

function emptyRow(t: number): MonthRow {
  return {
    t,
    depositGross: 0,
    reserveHeld: 0,
    depositNet: 0,
    pmtInflow: 0,
    principalIn: 0,
    incomeIn: 0,
    reserveRelease: 0,
    inflow: 0,
    loanOut: 0,
    withdrawalOut: 0,
    profitPaid: 0,
    fundingCost: 0,
    provisionCost: 0,
    writeOff: 0,
    outflow: 0,
    ncf: 0,
    cum: 0,
    depositBalance: 0,
    loanBook: 0,
    cumMargin: 0,
    events: [],
  };
}

export function simulate(input: SimInput, withDetails = true): SimResult {
  const { config, tiers, behavior, schedule } = input;
  const safeTiers = Array.isArray(tiers) ? tiers.filter((t) => !!t) : [];
  const H = Math.round(bounded(config.horizon, 1, MAX_MONTHS, 60));
  const RR = bounded(config.reserveRatio, 0, 100, 0) / 100;
  const take = bounded(behavior.takeUpRate, 0, 100, 0) / 100;
  const app = bounded(behavior.approvalRate, 0, 100, 0) / 100;
  const collectRatio = 1 - bounded(config.defaultRate, 0, 100, 0) / 100;
  const lossRatio = 1 - collectRatio; // سهم وصول‌نشدهٔ هر قسط (δ)
  const lgd = bounded(config.lgdRate, 0, 100, 100) / 100;
  const writeOffLag = Math.round(bounded(config.writeOffLag, 0, MAX_MONTHS, 12));
  const loanCap = bounded(config.loanCap, 0, MAX_MONEY, 0);
  const minLoan = bounded(config.minLoan, 0, MAX_MONEY, 0);
  const avgTicket = bounded(behavior.avgTicket, 0, MAX_MONEY, 0);
  const initLiq = bounded(config.initialLiquidity, -MAX_MONEY, MAX_MONEY, 0);
  const totalDepositInput = bounded(behavior.totalDeposit, 0, MAX_MONEY, 0);
  const contract = config.contractType === 'murabaha' ? 'murabaha' : 'qard';

  const rows: MonthRow[] = Array.from({ length: H + 1 }, (_, t) => emptyRow(t));
  const maps: Map<string, FlowEvent>[] | null = withDetails ? rows.map(() => new Map()) : null;
  const depDelta = new Float64Array(H + 1);
  const bookDelta = new Float64Array(H + 1);

  const vintages = buildVintages(totalDepositInput, schedule, H);
  const allocSum = safeTiers.reduce((s, t) => s + Math.max(0, finite(t.allocation, 0)), 0);

  let pmtBeyond = 0;
  let commitmentsBeyond = 0;

  const push = (
    t: number,
    type: EventType,
    tier: Tier,
    tierIndex: number,
    amount: number,
    vintageMonth: number,
    inst?: { j: number; total: number },
  ) => {
    if (!maps || !(amount > 0)) return;
    const key = `${type}|${tier.id}`;
    const m = maps[t];
    const e = m.get(key);
    if (e) {
      e.amount += amount;
      e.vintages += 1;
      e.vintageFrom = Math.min(e.vintageFrom, vintageMonth);
      e.vintageTo = Math.max(e.vintageTo, vintageMonth);
      if (inst && e.instFrom !== undefined && e.instTo !== undefined) {
        e.instFrom = Math.min(e.instFrom, inst.j);
        e.instTo = Math.max(e.instTo, inst.j);
      }
    } else {
      m.set(key, {
        type,
        tierId: tier.id,
        tierName: tier.name,
        tierIndex,
        amount,
        vintages: 1,
        vintageFrom: vintageMonth,
        vintageTo: vintageMonth,
        instFrom: inst?.j,
        instTo: inst?.j,
        instTotal: inst?.total,
      });
    }
  };

  /* ثبت ورود سپرده‌ها در ماتریس — مستقل از تخصیص پله‌ها تا تراز منابع همواره حفظ شود:
     Inflow(deposit)_t = D_new,t × (1 − RR) */
  const unallocated: Tier = {
    id: '__unallocated',
    name: 'سپرده بدون تخصیص پله',
    tDep: 0,
    tLoan: 0,
    alpha: 0,
    minBalance: 0,
    allocation: 0,
    rateOverride: null,
  };
  /* منبع رویدادهای سطح پرتفوی (سود پرداختی به کل سپرده‌ها) */
  const depositPool: Tier = { ...unallocated, id: '__deposit_pool', name: 'سپرده‌گذاران (کل منابع)' };
  for (const v of vintages) {
    const r0 = rows[v.month];
    r0.depositGross += v.amount;
    r0.reserveHeld += v.amount * RR;
    r0.depositNet += v.amount * (1 - RR);
    depDelta[v.month] += v.amount;
    if (allocSum <= 0) {
      push(v.month, 'deposit', unallocated, -1, v.amount, v.month);
      push(v.month, 'reserve', unallocated, -1, v.amount * RR, v.month);
    }
  }

  const tierResults: TierResult[] = safeTiers.map((tier, idx) => {
    const share = allocSum > 0 ? Math.max(0, finite(tier.allocation, 0)) / allocSum : 0;
    const { alpha, binding, repBalance } = effectiveAlpha(tier, loanCap, avgTicket);
    const minBalance = bounded(tier.minBalance, 0, MAX_MONEY, 0);
    const eligible = avgTicket >= minBalance; // فقط سپرده‌گذار واجد حداقل مانده امکان دریافت وام دارد
    // کف مبلغ تسهیلاتِ محصول نیز مانند حداقل مانده، پیش از تشکیل تعهد اعمال می‌شود:
    // اگر وام نمایندهٔ یک مشتری به کف نرسد، آن پله وامی اعطا نمی‌کند و فقط churn دارد.
    const meetsMinLoan = minLoan <= 0 || repBalance * alpha >= minLoan;
    const lends = eligible && alpha > 0 && meetsMinLoan; // آیا این پله اساساً تسهیلاتی اعطا می‌کند؟
    const wTier = tierWithdrawalFactor(behavior, lends);
    const rate = tierRate(tier, config);
    const T = Math.round(bounded(tier.tLoan, 1, MAX_MONTHS, 12));
    const tDep = Math.round(bounded(tier.tDep, TIER_WAIT_MIN, TIER_WAIT_MAX, TIER_WAIT_MIN));
    const unit = amortization(contract, 1, T, rate); // جدول استهلاک واحد (L = 1)
    const unitPay = unit.length ? unit[0].payment : 0;

    const res: TierResult = {
      tier,
      index: idx,
      share,
      deposit: 0,
      alphaEff: alpha,
      capBinding: binding,
      repBalance,
      eligible,
      lends,
      rate,
      commitment: 0,
      withdrawal: 0,
      monthlyPmt: 0,
      totalRepay: 0,
      totalIncome: 0,
      borrowers: 0,
      firstMaturity: null,
      lastMaturity: null,
      lastPayment: null,
      unitPay,
    };

    for (const v of vintages) {
      const D = v.amount * share;
      if (!(D > 0)) continue;

      const L = lends ? D * alpha * take * app : 0; // اگر پله وامی نمی‌دهد، تعهدی هم شکل نمی‌گیرد
      const W = D * wTier; // خروج اصل سپرده
      const pay = unitPay * L;

      res.deposit += D;
      res.commitment += L;
      res.withdrawal += W;
      res.monthlyPmt += pay;
      res.totalRepay += pay * T;
      res.totalIncome += pay * T - L;
      // برآورد تعداد وام‌گیرنده فقط وقتی معنا دارد که پله واقعاً اعطا کند و مانده مبنا معلوم باشد
      if (lends && repBalance > 0 && take > 0 && app > 0) res.borrowers += (D / repBalance) * take * app;

      // ۱) ورود سپرده (ماه ورود ویژه) — مقادیر ماتریس به صورت تجمیعی پیش‌تر ثبت شده‌اند
      const t0 = v.month;
      push(t0, 'deposit', tier, idx, D, t0);
      push(t0, 'reserve', tier, idx, D * RR, t0);

      // ۲) سررسید T_dep — خروج دوگانه
      const tm = t0 + tDep;
      res.firstMaturity = res.firstMaturity === null ? tm : Math.min(res.firstMaturity, tm);
      res.lastMaturity = res.lastMaturity === null ? tm : Math.max(res.lastMaturity, tm);
      res.lastPayment = res.lastPayment === null ? tm + T : Math.max(res.lastPayment, tm + T);

      if (tm <= H) {
        const rm = rows[tm];
        rm.loanOut += L;
        rm.withdrawalOut += W;
        depDelta[tm] -= W;
        bookDelta[tm] += L;
        push(tm, 'loan', tier, idx, L, t0);
        push(tm, 'withdrawal', tier, idx, W, t0);
        if (config.releaseReserve && RR > 0) {
          rm.reserveRelease += W * RR;
          push(tm, 'release', tier, idx, W * RR, t0);
        }
      } else {
        commitmentsBeyond += L + W;
      }

      /* ۲-ب) ذخیره و سوخت نکول (غیرنقدی — بدون رویداد دفتر کل تا اتحاد
         دفتر کل با CumLiq حفظ شود):
         - ذخیرهٔ زیان موردانتظار L·δ·LGD در ماه اعطا (tm) شناسایی می‌شود
         - همان مبلغ در ماه tm + T_loan + مهلت‌سوخت از مانده تسهیلات خارج می‌شود */
      const expectedLoss = L * lossRatio * lgd;
      if (tm <= H && expectedLoss > 0) rows[tm].provisionCost += expectedLoss;
      const two = tm + T + writeOffLag;
      if (two <= H && expectedLoss > 0) {
        bookDelta[two] -= expectedLoss;
        rows[two].writeOff += expectedLoss;
      }

      // ۳) وصول اقساط از T_dep + 1 تا T_dep + T_loan
      for (let j = 1; j <= T; j++) {
        const tp = tm + j;
        const u = unit[j - 1];
        const cash = u.payment * L * collectRatio;
        if (tp <= H) {
          const rp = rows[tp];
          rp.pmtInflow += cash;
          rp.principalIn += u.principal * L * collectRatio;
          rp.incomeIn += u.income * L * collectRatio;
          // Reduce the loan book only by principal actually collected; uncollected
          // principal remains outstanding under the model's default assumption.
          bookDelta[tp] -= u.principal * L * collectRatio;
          push(tp, 'pmt', tier, idx, cash, t0, { j, total: T });
        } else {
          pmtBeyond += cash;
        }
      }
    }
    return res;
  });

  /* ---- تجمیع ماتریس و محاسبه NCF / CumLiq ---- */
  // سود پرداختی به سپرده‌گذاران: ماه‌شمار روی «میانگین ماندهٔ ماهانه»
  // یعنی (ماندهٔ ابتدای ماه + ماندهٔ پایان ماه) / ۲. ماندهٔ ابتدای ماه صفر
  // صفر است. نرخ صفر (پیش‌فرض) این جریان را کاملاً خنثی می‌کند.
  const depMonthly = bounded(config.depositProfitRate, 0, MAX_RATE_PCT, 0) / 1200;
  const ibMonthly = bounded(config.interbankRate, 0, MAX_RATE_PCT, 0) / 1200;
  let cum = initLiq;
  let dep = 0;
  let book = 0;
  let prevDep = 0;
  for (const r of rows) {
    dep += depDelta[r.t];
    book += bookDelta[r.t];
    r.depositBalance = Math.max(0, dep);
    r.loanBook = Math.max(0, book);
    const avgDep = (Math.max(0, prevDep) + r.depositBalance) / 2;
    prevDep = dep;
    r.profitPaid = avgDep * depMonthly;
    r.inflow = r.depositNet + r.pmtInflow + r.reserveRelease;
    r.outflow = r.loanOut + r.withdrawalOut + r.profitPaid;
    r.ncf = r.inflow - r.outflow;
    cum += r.ncf;
    r.cum = cum;
    if (maps) {
      push(r.t, 'profit', depositPool, -1, r.profitPaid, r.t);
      r.events = Array.from(maps[r.t].values()).sort(
        (a, b) => EVENT_ORDER[a.type] - EVENT_ORDER[b.type] || a.tierIndex - b.tierIndex,
      );
    }
  }

  /* ---- شاخص‌های کلیدی ریسک نقدینگی ---- */
  const totalDeposit = vintages.reduce((s, v) => s + v.amount, 0);
  const netDeposit = totalDeposit * (1 - RR);
  const totalCommitment = tierResults.reduce((s, r) => s + r.commitment, 0);
  const totalWithdrawal = tierResults.reduce((s, r) => s + r.withdrawal, 0);
  const borrowers = tierResults.reduce((s, r) => s + r.borrowers, 0);

  let minCum = Infinity;
  let minCumMonth = 0;
  let tippingPoint: number | null = null;
  let deficitMonths = 0;
  let interbankCost = 0;
  let peakOutflow = 0;
  let peakOutflowMonth = 0;
  let totalPmtInHorizon = 0;
  let totalIncomeInHorizon = 0;
  let totalProfitPaid = 0;
  let totalProvision = 0;
  let totalWriteOff = 0;
  let cumMargin = 0;

  for (const r of rows) {
    if (r.cum < minCum - EPS) {
      minCum = r.cum;
      minCumMonth = r.t;
    }
    // هزینهٔ تأمین کسری در همان ماهی که کسری وجود دارد شناسایی می‌شود
    const ibCost = r.cum < -EPS ? -r.cum * ibMonthly : 0;
    if (r.cum < -EPS) {
      deficitMonths++;
      if (tippingPoint === null) tippingPoint = r.t;
    }
    interbankCost += ibCost;
    r.fundingCost = ibCost;
    if (r.outflow > peakOutflow + EPS) {
      peakOutflow = r.outflow;
      peakOutflowMonth = r.t;
    }
    totalPmtInHorizon += r.pmtInflow;
    totalIncomeInHorizon += r.incomeIn;
    totalProfitPaid += r.profitPaid;
    totalProvision += r.provisionCost;
    totalWriteOff += r.writeOff;
    // حاشیهٔ تجمعی بانک: درآمد کارمزد/سود − سود پرداختی سپرده − هزینهٔ تأمین کسری − هزینهٔ ذخیره مطالبات
    cumMargin += r.incomeIn - r.profitPaid - ibCost - r.provisionCost;
    r.cumMargin = cumMargin;
  }

  /* اهرم خروج: اگر منابع خالص صفر باشد (مثلاً RR = ۱۰۰٪) و همچنان خروجی وجود داشته
     باشد، اهرم بی‌نهایت است — نمایش «۰×» در این حالت به‌اشتباه ایمن به نظر می‌رسد. */
  const grossOutflow = totalCommitment + totalWithdrawal;
  const leverage = netDeposit > EPS ? grossOutflow / netDeposit : grossOutflow > EPS ? Infinity : 0;

  let recoveryMonth: number | null = null;
  if (tippingPoint !== null) {
    for (let t = minCumMonth + 1; t <= H; t++) {
      if (rows[t].cum >= -EPS) {
        recoveryMonth = t;
        break;
      }
    }
  }

  const kpis: SimKpis = {
    totalDeposit,
    netDeposit,
    reserveHeld: totalDeposit * RR,
    totalCommitment,
    totalWithdrawal,
    leverage,
    minCum: Number.isFinite(minCum) ? minCum : 0,
    minCumMonth,
    maxHole: minCum < -EPS ? -minCum : 0,
    tippingPoint,
    recoveryMonth,
    deficitMonths,
    endCum: rows[H].cum,
    totalPmtInHorizon,
    totalIncomeInHorizon,
    pmtBeyondHorizon: pmtBeyond,
    commitmentsBeyondHorizon: commitmentsBeyond,
    interbankCost,
    borrowers,
    peakOutflow,
    peakOutflowMonth,
    totalProfitPaid,
    netInterestIncome: totalIncomeInHorizon - totalProfitPaid,
    totalProvision,
    totalWriteOff,
    netMargin: cumMargin,
    /* حاشیه به درصد منابع ورودی خالص. وقتی مخرج صفر است (مثلاً RR = ۱۰۰٪)
       عدد صفر «سر‌به‌سر» به نظر می‌رسد در حالی که طرح می‌تواند ده‌ها میلیارد
       زیان داشته باشد؛ پس مانند اهرم خروج، علامت بی‌نهایت حفظ می‌شود. */
    marginOnNetDeposit:
      netDeposit > EPS
        ? cumMargin / netDeposit
        : cumMargin > EPS
          ? Infinity
          : cumMargin < -EPS
            ? -Infinity
            : 0,
  };

  return { rows, tiers: tierResults, kpis, vintages };
}

/* ------------------ نرخ مؤثر (IRR) و مقایسه نمونه ------------------ */

/** نرخ ماهانه i به طوری که pv = pmt · (1 − (1+i)^−n) / i  (روش دوبخشی) */
export function solveMonthlyRate(pv: number, pmt: number, n: number): number | null {
  if (!(pv > 0) || !(pmt > 0) || !(n > 0)) return null;
  const f = (i: number) => (Math.abs(i) < 1e-10 ? pmt * n : (pmt * (1 - Math.pow(1 + i, -n))) / i) - pv;
  let lo = -0.5;
  let hi = 10;
  if (f(lo) < 0 || f(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

export const annualize = (i: number) => Math.pow(1 + i, 12) - 1;

export interface TierOfferEstimate {
  rate: number;
  eligible: boolean;
  /** مشتری به‌دلیل کف مبلغ تسهیلات از حالت خارج شده است */
  belowMinimumLoan: boolean;
  rawLoan: number;
  loan: number;
  capped: boolean;
  minimumLoan: number;
  monthlyPayment: number;
  totalRepayment: number;
  totalCharge: number;
}

/** برآورد وام و قسط یک مشتری برای یک حالت، با همان قواعد حداقل مانده و سقف فردی */
export function estimateTierOffer(tier: Tier, config: GlobalConfig, depositBalance: number): TierOfferEstimate {
  const balance = bounded(depositBalance, 0, MAX_MONEY, 0);
  const cap = bounded(config.loanCap, 0, MAX_MONEY, 0);
  const minimum = bounded(tier.minBalance, 0, MAX_MONEY, 0);
  const minimumLoan = bounded(config.minLoan, 0, MAX_MONEY, 0);
  const months = Math.round(bounded(tier.tLoan, 1, MAX_MONTHS, 12));
  const rate = tierRate(tier, config);
  const balanceEligible = balance > 0 && balance >= minimum;
  const rawLoan = balanceEligible ? (balance * Math.max(0, finite(tier.alpha, 0))) / 100 : 0;
  const belowMinimumLoan = balanceEligible && minimumLoan > 0 && rawLoan < minimumLoan;
  const eligible = balanceEligible && !belowMinimumLoan;
  const capped = eligible && cap > 0 && rawLoan > cap;
  const loan = !eligible ? 0 : capped ? cap : rawLoan;
  const monthlyPayment = calcPmt(config.contractType === 'murabaha' ? 'murabaha' : 'qard', loan, months, rate);
  const totalRepayment = monthlyPayment * months;

  return {
    rate,
    eligible,
    belowMinimumLoan,
    rawLoan,
    loan,
    capped,
    minimumLoan,
    monthlyPayment,
    totalRepayment,
    totalCharge: totalRepayment - loan,
  };
}

export interface SampleRow {
  tier: Tier;
  index: number;
  rate: number;
  eligible: boolean;
  belowMinimumLoan: boolean;
  rawLoan: number;
  loan: number;
  capped: boolean;
  pmt: number;
  totalRepay: number;
  totalFee: number;
  roi: number;
  apr: number | null;
  oppCost: number;
  customerCost: number | null;
  cycle: number;
}

export function sampleComparison(tiers: Tier[], config: GlobalConfig, sample: number): SampleRow[] {
  const S = bounded(sample, 0, MAX_MONEY, 0);
  const oppRate = bounded(config.opportunityRate, 0, MAX_RATE_PCT, 0);
  return (Array.isArray(tiers) ? tiers.filter((t) => !!t) : []).map((tier, index) => {
    const offer = estimateTierOffer(tier, config, S);
    const T = Math.round(bounded(tier.tLoan, 1, MAX_MONTHS, 12));
    const tDep = bounded(tier.tDep, TIER_WAIT_MIN, TIER_WAIT_MAX, TIER_WAIT_MIN);
    const {
      rate,
      eligible,
      belowMinimumLoan,
      rawLoan,
      loan,
      capped,
      monthlyPayment: pmt,
      totalRepayment: totalRepay,
      totalCharge: totalFee,
    } = offer;
    const roi = loan > 0 ? totalFee / loan : 0;
    const i = solveMonthlyRate(loan, pmt, T);
    const oppCost = eligible ? S * (Math.pow(1 + oppRate / 1200, tDep) - 1) : 0;
    const netLoan = loan - oppCost;
    const ic = netLoan > 0 ? solveMonthlyRate(netLoan, pmt, T) : null;
    return {
      tier,
      index,
      rate,
      eligible,
      belowMinimumLoan,
      rawLoan,
      loan,
      capped,
      pmt,
      totalRepay,
      totalFee,
      roi,
      apr: i === null ? null : annualize(i),
      oppCost,
      customerCost: ic === null ? null : annualize(ic),
      cycle: Math.round(tier.tDep) + T,
    };
  });
}

/* ------------------------ تحلیل حساسیت دوبعدی ------------------------ */

export type SensVar =
  | 'defaultRate'
  | 'takeUpRate'
  | 'approvalRate'
  | 'runoffRate'
  | 'churnRate'
  | 'reserveRatio'
  | 'alphaScale'
  | 'rate'
  | 'profitRate';

export type SensMetric = 'maxHole' | 'tipping' | 'endCum' | 'leverage' | 'margin';

export interface SensVarDef {
  key: SensVar;
  label: string;
  symbol: string;
  values: (input: SimInput) => number[];
  current: (input: SimInput) => number;
}

export const SENS_VARS: SensVarDef[] = [
  {
    key: 'defaultRate',
    label: 'نرخ نکول اقساط',
    symbol: 'δ',
    values: () => [0, 2, 5, 10, 15, 25, 40],
    current: (i) => i.config.defaultRate,
  },
  {
    key: 'takeUpRate',
    label: 'نرخ تقاضای وام',
    symbol: 'ρ_take',
    values: () => [40, 50, 60, 70, 80, 90, 100],
    current: (i) => i.behavior.takeUpRate,
  },
  {
    key: 'approvalRate',
    label: 'نرخ قبولی اعتباری',
    symbol: 'ρ_app',
    values: () => [50, 60, 70, 80, 90, 95, 100],
    current: (i) => i.behavior.approvalRate,
  },
  {
    key: 'runoffRate',
    label: 'خروج سپرده وام‌گیرندگان',
    symbol: 'ω_with',
    values: () => [30, 45, 60, 70, 80, 90, 100],
    current: (i) => i.behavior.runoffRate,
  },
  {
    key: 'churnRate',
    label: 'خروج انصراف‌دهندگان',
    symbol: 'ω_churn',
    values: () => [0, 20, 35, 50, 65, 80, 100],
    current: (i) => i.behavior.churnRate,
  },
  {
    key: 'reserveRatio',
    label: 'نرخ سپرده قانونی',
    symbol: 'RR',
    values: () => [0, 5, 8, 10, 13, 15, 20],
    current: (i) => i.config.reserveRatio,
  },
  {
    key: 'alphaScale',
    label: 'مقیاس ضرایب برابری',
    symbol: 'α×',
    values: () => [50, 75, 90, 100, 110, 125, 150],
    current: () => 100,
  },
  {
    key: 'rate',
    label: 'نرخ کارمزد / سود',
    symbol: 'r',
    values: (i) => (i.config.contractType === 'qard' ? [0, 2, 4, 6, 8, 10, 12] : [5, 9, 13, 17, 21, 25, 29]),
    current: (i) => globalRate(i.config),
  },
  {
    key: 'profitRate',
    label: 'سود پرداختی سپرده',
    symbol: 'r_dep',
    values: () => [0, 5, 10, 15, 20.5, 25, 30],
    current: (i) => i.config.depositProfitRate,
  },
];

export function applySensitivity(input: SimInput, key: SensVar, value: number): SimInput {
  const tiers = Array.isArray(input.tiers) ? input.tiers : [];
  switch (key) {
    case 'takeUpRate':
    case 'approvalRate':
    case 'runoffRate':
    case 'churnRate':
      return { ...input, behavior: { ...input.behavior, [key]: bounded(value, 0, 100, 0) } };
    case 'defaultRate':
      return { ...input, config: { ...input.config, defaultRate: bounded(value, 0, 100, 0) } };
    case 'reserveRatio':
      return { ...input, config: { ...input.config, reserveRatio: bounded(value, 0, 100, 0) } };
    case 'profitRate':
      return { ...input, config: { ...input.config, depositProfitRate: bounded(value, 0, 100, 0) } };
    case 'alphaScale':
      return {
        ...input,
        tiers: tiers.map((t) => ({ ...t, alpha: (Math.max(0, finite(t.alpha, 0)) * bounded(value, 0, 1e6, 100)) / 100 })),
      };
    case 'rate': {
      const r = bounded(value, 0, MAX_RATE_PCT, 0);
      const delta = r - globalRate(input.config);
      return {
        ...input,
        config: { ...input.config, qardFeeRate: r, murabahaRate: r },
        // Apply the same parallel rate shock to tier-specific prices. At the
        // current global rate (delta = 0), the original scenario is preserved.
        tiers: tiers.map((t) => ({
          ...t,
          rateOverride:
            t.rateOverride === null || t.rateOverride === undefined ? null : Math.max(0, finite(t.rateOverride, 0) + delta),
        })),
      };
    }
    default:
      return input;
  }
}

function withCurrent(values: number[], cur: number): number[] {
  const c = Math.round(finite(cur, values[0] ?? 0) * 100) / 100;
  if (values.includes(c)) return values;
  let best = 0;
  values.forEach((v, i) => {
    if (Math.abs(v - c) < Math.abs(values[best] - c)) best = i;
  });
  const next = [...values];
  next[best] = c;
  return next.sort((a, b) => a - b);
}

export interface SensitivityGrid {
  xs: number[];
  ys: number[];
  cells: SimKpis[][];
  xi: number;
  yi: number;
}

export function runSensitivity(input: SimInput, xKey: SensVar, yKey: SensVar): SensitivityGrid {
  const xDef = SENS_VARS.find((v) => v.key === xKey) ?? SENS_VARS[0];
  const yDef = SENS_VARS.find((v) => v.key === yKey) ?? SENS_VARS[1];
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const curX = round2(finite(xDef.current(input), 0));
  const curY = round2(finite(yDef.current(input), 0));
  const xs = withCurrent(xDef.values(input), curX);
  const ys = withCurrent(yDef.values(input), curY);
  const cells = ys.map((yv) =>
    xs.map((xv) => simulate(applySensitivity(applySensitivity(input, yDef.key, yv), xDef.key, xv), false).kpis),
  );
  const xi = xs.indexOf(curX);
  const yi = ys.indexOf(curY);
  return { xs, ys, cells, xi: xi < 0 ? 0 : xi, yi: yi < 0 ? 0 : yi };
}

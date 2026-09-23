/* ------------------------------------------------------------------ *
 *  ALM SIMULATION ENGINE — Cohort / Vintage based cash-flow matrix
 *
 *  الف) استهلاک اقساط:
 *     قرض‌الحسنه:  PMT = (L / T) · (1 + r_f · T / 12)
 *     مرابحه:      PMT = L · r_m (1 + r_m)^T / ((1 + r_m)^T − 1) ,  r_m = r / 12
 *  ب) خروج همزمان (Double Liquidity Drain) در ماه سررسید T_dep:
 *     Commitment = D · α · ρ_take · ρ_app
 *     Withdrawal = D · [ρ_take · ω_with + (1 − ρ_take) · ω_churn]
 *  ج) ماتریس جریان وجوه:
 *     Inflows_t  = D_new,t · (1 − RR) + Σ PMT_k,t
 *     Outflows_t = Σ Commitment_k,t + Σ Withdrawal_k,t
 *     NCF_t = Inflows_t − Outflows_t ;  CumLiq_t = CumLiq_{t−1} + NCF_t
 *  د) Tipping Point = اولین t با CumLiq_t < 0 ؛ Max Hole = min(CumLiq_t)
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

export const EPS = 1e-6;

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function globalRate(config: GlobalConfig): number {
  return config.contractType === 'qard' ? config.qardFeeRate : config.murabahaRate;
}

export function tierRate(tier: Tier, config: GlobalConfig): number {
  return tier.rateOverride !== null && tier.rateOverride !== undefined && Number.isFinite(tier.rateOverride)
    ? tier.rateOverride
    : globalRate(config);
}

/* ---------------------------- الف) PMT ---------------------------- */

export function calcPmt(contract: ContractType, loan: number, months: number, annualRatePct: number): number {
  if (!(loan > 0) || !(months > 0)) return 0;
  const r = annualRatePct / 100;
  if (contract === 'qard') {
    return (loan / months) * (1 + (r * months) / 12);
  }
  const rm = r / 12;
  if (Math.abs(rm) < 1e-12) return loan / months;
  const f = Math.pow(1 + rm, months);
  return (loan * rm * f) / (f - 1);
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
  const n = Math.max(0, Math.round(months));
  const pay = calcPmt(contract, loan, n, annualRatePct);
  const rm = annualRatePct / 1200;
  const out: AmortRow[] = [];
  let bal = loan;
  for (let j = 1; j <= n; j++) {
    let principal: number;
    let income: number;
    if (contract === 'qard' || Math.abs(rm) < 1e-12) {
      principal = loan / n;
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
  return Math.max(avgTicket > 0 ? avgTicket : 0, tier.minBalance > 0 ? tier.minBalance : 0);
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
  const a = Math.max(0, tier.alpha) / 100;
  const rep = representativeBalance(tier, avgTicket);
  if (loanCap > 0 && rep > 0 && loanCap / rep < a) {
    return { alpha: loanCap / rep, binding: true, repBalance: rep };
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

/* ------------------------ ساخت ویژه‌های ورودی ------------------------ */

export function buildVintages(total: number, schedule: DepositSchedule, horizon: number): Vintage[] {
  if (!(total > 0)) return [];
  if (schedule.mode === 'lump') return [{ month: 0, amount: total }];
  if (schedule.mode === 'uniform') {
    const n = Math.round(clamp(schedule.uniformMonths, 1, horizon + 1));
    return Array.from({ length: n }, (_, i) => ({ month: i, amount: total / n }));
  }
  const positive = schedule.custom.filter((v) => v.share > 0);
  const sum = positive.reduce((s, v) => s + v.share, 0);
  if (sum <= 0) return [];
  const map = new Map<number, number>();
  for (const v of positive) {
    const m = Math.round(v.month);
    if (m < 0 || m > horizon) continue; // خارج از افق
    map.set(m, (map.get(m) ?? 0) + (total * v.share) / sum);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([month, amount]) => ({ month, amount }));
}

/* ----------------------- موتور ماتریس نقدینگی ----------------------- */

const EVENT_ORDER: Record<EventType, number> = {
  deposit: 0,
  reserve: 1,
  release: 2,
  pmt: 3,
  loan: 4,
  withdrawal: 5,
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
    outflow: 0,
    ncf: 0,
    cum: 0,
    depositBalance: 0,
    loanBook: 0,
    events: [],
  };
}

export function simulate(input: SimInput, withDetails = true): SimResult {
  const { config, tiers, behavior, schedule } = input;
  const H = Math.round(clamp(config.horizon, 1, 600));
  const RR = clamp(config.reserveRatio, 0, 100) / 100;
  const take = clamp(behavior.takeUpRate, 0, 100) / 100;
  const app = clamp(behavior.approvalRate, 0, 100) / 100;
  const wFactor = withdrawalFactor(behavior);
  const collectRatio = 1 - clamp(config.defaultRate, 0, 100) / 100;
  const contract = config.contractType;

  const rows: MonthRow[] = Array.from({ length: H + 1 }, (_, t) => emptyRow(t));
  const maps: Map<string, FlowEvent>[] | null = withDetails ? rows.map(() => new Map()) : null;
  const depDelta = new Float64Array(H + 1);
  const bookDelta = new Float64Array(H + 1);

  const vintages = buildVintages(behavior.totalDeposit, schedule, H);
  const allocSum = tiers.reduce((s, t) => s + Math.max(0, t.allocation || 0), 0);

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

  const tierResults: TierResult[] = tiers.map((tier, idx) => {
    const share = allocSum > 0 ? Math.max(0, tier.allocation || 0) / allocSum : 0;
    const { alpha, binding, repBalance } = effectiveAlpha(tier, config.loanCap, behavior.avgTicket);
    const rate = tierRate(tier, config);
    const T = Math.max(1, Math.round(tier.tLoan));
    const tDep = Math.max(0, Math.round(tier.tDep));
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

      const L = D * alpha * take * app; // تعهد اعطای وام
      const W = D * wFactor; // خروج اصل سپرده
      const pay = unitPay * L;

      res.deposit += D;
      res.commitment += L;
      res.withdrawal += W;
      res.monthlyPmt += pay;
      res.totalRepay += pay * T;
      res.totalIncome += pay * T - L;
      if (repBalance > 0) res.borrowers += (D / repBalance) * take * app;

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
          bookDelta[tp] -= u.principal * L;
          push(tp, 'pmt', tier, idx, cash, t0, { j, total: T });
        } else {
          pmtBeyond += cash;
        }
      }
    }
    return res;
  });

  /* ---- تجمیع ماتریس و محاسبه NCF / CumLiq ---- */
  let cum = Number.isFinite(config.initialLiquidity) ? config.initialLiquidity : 0;
  let dep = 0;
  let book = 0;
  for (const r of rows) {
    r.inflow = r.depositNet + r.pmtInflow + r.reserveRelease;
    r.outflow = r.loanOut + r.withdrawalOut;
    r.ncf = r.inflow - r.outflow;
    cum += r.ncf;
    r.cum = cum;
    dep += depDelta[r.t];
    book += bookDelta[r.t];
    r.depositBalance = Math.max(0, dep);
    r.loanBook = Math.max(0, book);
    if (maps) {
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
  const ibMonthly = Math.max(0, config.interbankRate) / 1200;

  for (const r of rows) {
    if (r.cum < minCum - EPS) {
      minCum = r.cum;
      minCumMonth = r.t;
    }
    if (r.cum < -EPS) {
      deficitMonths++;
      if (tippingPoint === null) tippingPoint = r.t;
      interbankCost += -r.cum * ibMonthly;
    }
    if (r.outflow > peakOutflow + EPS) {
      peakOutflow = r.outflow;
      peakOutflowMonth = r.t;
    }
    totalPmtInHorizon += r.pmtInflow;
    totalIncomeInHorizon += r.incomeIn;
  }

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
    leverage: netDeposit > 0 ? (totalCommitment + totalWithdrawal) / netDeposit : 0,
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

export interface SampleRow {
  tier: Tier;
  index: number;
  rate: number;
  eligible: boolean;
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
  return tiers.map((tier, index) => {
    const rate = tierRate(tier, config);
    const T = Math.max(1, Math.round(tier.tLoan));
    const eligible = sample > 0 && sample >= (tier.minBalance || 0);
    const rawLoan = eligible ? (sample * Math.max(0, tier.alpha)) / 100 : 0;
    const capped = config.loanCap > 0 && rawLoan > config.loanCap;
    const loan = capped ? config.loanCap : rawLoan;
    const pmt = calcPmt(config.contractType, loan, T, rate);
    const totalRepay = pmt * T;
    const totalFee = totalRepay - loan;
    const roi = loan > 0 ? totalFee / loan : 0;
    const i = solveMonthlyRate(loan, pmt, T);
    const oppCost = eligible ? sample * (Math.pow(1 + Math.max(0, config.opportunityRate) / 1200, tier.tDep) - 1) : 0;
    const netLoan = loan - oppCost;
    const ic = netLoan > 0 ? solveMonthlyRate(netLoan, pmt, T) : null;
    return {
      tier,
      index,
      rate,
      eligible,
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
  | 'takeUpRate'
  | 'approvalRate'
  | 'runoffRate'
  | 'churnRate'
  | 'reserveRatio'
  | 'alphaScale'
  | 'rate';

export type SensMetric = 'maxHole' | 'tipping' | 'endCum' | 'leverage';

export interface SensVarDef {
  key: SensVar;
  label: string;
  symbol: string;
  values: (input: SimInput) => number[];
  current: (input: SimInput) => number;
}

export const SENS_VARS: SensVarDef[] = [
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
];

export function applySensitivity(input: SimInput, key: SensVar, value: number): SimInput {
  switch (key) {
    case 'takeUpRate':
    case 'approvalRate':
    case 'runoffRate':
    case 'churnRate':
      return { ...input, behavior: { ...input.behavior, [key]: value } };
    case 'reserveRatio':
      return { ...input, config: { ...input.config, reserveRatio: value } };
    case 'alphaScale':
      return { ...input, tiers: input.tiers.map((t) => ({ ...t, alpha: (t.alpha * value) / 100 })) };
    case 'rate':
      return {
        ...input,
        config: { ...input.config, qardFeeRate: value, murabahaRate: value },
        tiers: input.tiers.map((t) => ({ ...t, rateOverride: null })),
      };
    default:
      return input;
  }
}

function withCurrent(values: number[], cur: number): number[] {
  const c = Math.round(cur * 100) / 100;
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
  const curX = Math.round(xDef.current(input) * 100) / 100;
  const curY = Math.round(yDef.current(input) * 100) / 100;
  const xs = withCurrent(xDef.values(input), curX);
  const ys = withCurrent(yDef.values(input), curY);
  const cells = ys.map((yv) =>
    xs.map((xv) => simulate(applySensitivity(applySensitivity(input, yDef.key, yv), xDef.key, xv), false).kpis),
  );
  return { xs, ys, cells, xi: xs.indexOf(curX), yi: ys.indexOf(curY) };
}

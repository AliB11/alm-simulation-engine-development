import { useMemo, useState, type ReactNode } from 'react';
import { Sigma, SquareFunction } from 'lucide-react';
import type { Behavior, GlobalConfig, SimResult } from '../types';
import { tierAttribution } from '../lib/attribution';
import { fmtPct, fmtRaw, fmtRatio, toFa } from '../lib/format';
import { tierColor } from '../lib/presets';
import { computeRegulatory, type RegulatoryParams } from '../lib/regulatory';
import { useDisplay } from '../context/display';
import { Card, CardHeader } from './ui';

function Step({
  letter,
  title,
  desc,
  children,
  className,
}: {
  letter: string;
  title: string;
  desc: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={'rounded-xl border border-slate-200/80 p-4 dark:border-slate-800' + (className ? ` ${className}` : '')}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-[13px] font-black text-white">
          {letter}
        </span>
        <h4 className="text-[13.5px] font-extrabold text-slate-800 dark:text-slate-100">{title}</h4>
      </div>
      <p className="mb-3 text-[11.5px] leading-6 text-slate-500 dark:text-slate-400">{desc}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Formula({ children, live }: { children: ReactNode; live?: ReactNode }) {
  return (
    <div
      dir="ltr"
      className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 text-left font-mono text-[11.5px] leading-6 text-slate-100 dark:bg-slate-950 dark:ring-1 dark:ring-slate-800"
    >
      <div className="whitespace-nowrap text-indigo-200">{children}</div>
      {live && <div className="mt-1 whitespace-nowrap border-t border-white/10 pt-1 text-emerald-300">{live}</div>}
    </div>
  );
}

interface Props {
  result: SimResult;
  config: GlobalConfig;
  behavior: Behavior;
  regulatory: RegulatoryParams;
}

export function Methodology({ result, config, behavior, regulatory }: Props) {
  const { factor, unit } = useDisplay();
  const [sel, setSel] = useState(0);
  const tr = result.tiers[Math.min(sel, Math.max(0, result.tiers.length - 1))];
  const k = result.kpis;
  const reg = useMemo(() => computeRegulatory(result.rows, regulatory), [result.rows, regulatory]);
  const attr = useMemo(() => tierAttribution(result.rows, tierColor), [result.rows]);
  const worst = attr.tiers.reduce(
    (acc, t) => (acc === null || t.holeDelta < acc.holeDelta ? t : acc),
    null as (typeof attr.tiers)[number] | null,
  );
  const m = (v: number) => fmtRaw(Math.round(v * factor));
  const p = (v: number, d = 2) => fmtRaw(v, d);
  const take = behavior.takeUpRate / 100;
  const app = behavior.approvalRate / 100;
  const ww = behavior.runoffRate / 100;
  const wc = behavior.churnRate / 100;
  const RR = config.reserveRatio / 100;
  const isQard = config.contractType === 'qard';

  return (
    <Card>
      <CardHeader
        icon={<SquareFunction />}
        title="شفافیت موتور محاسباتی — منطق ریاضی و الگوریتم‌ها"
        subtitle={`هیچ ضریبی در کد هاردکد نشده است؛ فرمول‌ها با مقادیر زنده پله انتخابی جایگذاری شده‌اند (ارقام به ${unit})`}
        actions={
          result.tiers.length > 0 && (
            <select
              value={sel}
              onChange={(e) => setSel(Number(e.target.value))}
              className="h-9 max-w-[260px] rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {result.tiers.map((t, i) => (
                <option key={t.tier.id} value={i}>
                  پله {toFa(i + 1)}: {t.tier.name}
                </option>
              ))}
            </select>
          )
        }
      />
      {!tr ? (
        <div className="p-8 text-center text-sm text-slate-400">برای نمایش جایگذاری زنده، حداقل یک پله تعریف کنید.</div>
      ) : (
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <Step
            letter="الف"
            title="فرمولاسیون استهلاک اقساط ماهانه (Loan Amortization)"
            desc={
              <>
                مبلغ قسط ماهانه بسته به نوع عقد محاسبه می‌شود. برای پله{' '}
                <b style={{ color: tierColor(tr.index) }}>{tr.tier.name}</b> با T_loan = {toFa(tr.tier.tLoan)} ماه و نرخ{' '}
                {toFa(p(tr.rate))}٪ (عقد {isQard ? 'قرض‌الحسنه' : 'مرابحه'}):
              </>
            }
          >
            <Formula
              live={
                isQard
                  ? `PMT = (${m(tr.commitment)} / ${toFa(tr.tier.tLoan)}) × (۱ + ${p(tr.rate / 100, 4)} × ${toFa(tr.tier.tLoan)}/۱۲) = ${m(tr.monthlyPmt)}`
                  : `r_m = ${p(tr.rate / 100, 4)} / 12 = ${p(tr.rate / 1200, 6)}  →  PMT = ${m(tr.monthlyPmt)}`
              }
            >
              {isQard ? 'PMT_qard = (L / T_loan) × (1 + r_f × T_loan / 12)' : 'PMT_murabaha = L × r_m(1 + r_m)^T / ((1 + r_m)^T − 1)'}
            </Formula>
            <Formula live={`Total = ${m(tr.monthlyPmt)} × ${toFa(tr.tier.tLoan)} = ${m(tr.totalRepay)}  |  Fee = ${m(tr.totalIncome)}`}>
              Total Repayment = PMT × T_loan ;  Fee / Profit = Total − L
            </Formula>
            {config.defaultRate > 0 && (
              <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                ارقام بالا <b>قراردادی</b> هستند (بدون در نظر گرفتن نکول). با نرخ نکول {fmtPct(config.defaultRate)}، مجموع اقساط
                وصول‌شده در افق {m(k.totalPmtInHorizon)} و درآمد کارمزد/سود وصول‌شده {m(k.totalIncomeInHorizon)} {unit} است.
              </p>
            )}
          </Step>

          <Step
            letter="ب"
            title="تعهدات و خروج همزمان سپرده (Double Liquidity Drain)"
            desc="به دلیل ممنوعیت مسدودسازی سپرده، در ماه سررسید T_dep دو رویداد خروجی همزمان رخ می‌دهد: اعطای وام و برداشت اصل سپرده."
          >
            <Formula
              live={`α_eff = min(${p(tr.tier.alpha / 100, 2)}, ${
                config.loanCap > 0 && tr.repBalance > 0 ? `${m(config.loanCap)} / ${m(tr.repBalance)}` : '∞'
              }) = ${p(tr.alphaEff, 4)}`}
            >
              α_eff = min(α , Cap / max(AvgTicket, MinBalance))
            </Formula>
            <Formula
              live={
                tr.lends
                  ? `L = ${m(tr.deposit)} × ${p(tr.alphaEff, 4)} × ${p(take)} × ${p(app)} = ${m(tr.commitment)}`
                  : `L = 0   —   ${tr.eligible ? 'α_eff = 0' : 'AvgTicket < MinBalance'} ⇒ this tier grants no loan`
              }
            >
              Commitment_loan = D × α × ρ_take × ρ_app
            </Formula>
            <Formula
              live={
                tr.lends
                  ? `W = ${m(tr.deposit)} × [${p(take)}×${p(ww)} + ${p(1 - take)}×${p(wc)}] = ${m(tr.withdrawal)}`
                  : `W = ${m(tr.deposit)} × ${p(wc)}   —   no borrower ⇒ ω_churn only = ${m(tr.withdrawal)}`
              }
            >
              Withdrawal_dep = D × [ρ_take × ω_with + (1 − ρ_take) × ω_churn]
            </Formula>
          </Step>

          <Step
            letter="ج"
            title="ماتریس دینامیک جریان وجوه نقد (Vintage Cash-Flow)"
            desc={
              <>
                برای هر ویژه ورودی در ماه s و هر پله k: سپرده خالص در ماه s، تعهد و برداشت در ماه s + T_dep و اقساط در ماه‌های
                s + T_dep + 1 تا s + T_dep + T_loan ثبت می‌شوند. تعداد ویژه‌های فعال: {toFa(result.vintages.length)}.
              </>
            }
          >
            <Formula live={`RR = ${p(RR)}  →  Net deposits = ${m(k.totalDeposit)} × ${p(1 - RR)} = ${m(k.netDeposit)}`}>
              Inflows_t = D_new,t × (1 − RR) + Σ_k PMT_k,t
            </Formula>
            <Formula
              live={`Σ Commitments = ${m(k.totalCommitment)}  |  Σ Withdrawals = ${m(k.totalWithdrawal)}  |  Σ Deposit profit = ${m(k.totalProfitPaid)}`}
            >
              Outflows_t = Σ_k Commitment_k,t + Σ_k Withdrawal_k,t + DepositProfit_t
            </Formula>
            <Formula
              live={`Leverage = (${m(k.totalCommitment)} + ${m(k.totalWithdrawal)}) / ${m(k.netDeposit)} = ${
                Number.isFinite(k.leverage) ? `${p(k.leverage, 3)}×` : '∞ (net resources = 0)'
              }`}
            >
              NCF_t = Inflows_t − Outflows_t ;  CumLiq_t = CumLiq_(t−1) + NCF_t
            </Formula>
          </Step>

          <Step
            letter="د"
            title="شاخص‌های کلیدی ریسک نقدینگی"
            desc="نقطه واژگونی اولین ماهی است که مانده تجمعی منفی می‌شود؛ حداکثر کسری، کمینه مانده تجمعی و معادل حداکثر خط اعتباری مورد نیاز از بازار بین‌بانکی است."
          >
            <Formula live={k.tippingPoint === null ? 'Tipping Point = none (CumLiq ≥ 0 ∀t)' : `Tipping Point = month ${toFa(k.tippingPoint)}`}>
              Tipping Point = min{'{'} t : CumLiq_t {'<'} 0 {'}'}
            </Formula>
            <Formula live={`min(CumLiq) = ${m(k.minCum)} at month ${toFa(k.minCumMonth)}`}>Max Liquidity Hole = min_t (CumLiq_t)</Formula>
            <Formula live={`Interbank cost ≈ ${m(k.interbankCost)}  (r_ib = ${p(config.interbankRate)}%)`}>
              Funding Cost = Σ_t max(0, −CumLiq_t) × r_ib / 12
            </Formula>
          </Step>

          <Step
            letter="هـ"
            className="lg:col-span-2"
            title="صورت سود و زیان — حاشیهٔ خالص بانک در افق"
            desc="چهار جریان سود/هزینه شناسایی می‌شود: درآمد کارمزد یا سود اقساط وصول‌شده، سود پرداختی روی میانگین ماندهٔ ماهانهٔ سپرده‌ها، هزینهٔ تأمین کسری نقدینگی از بازار بین‌بانکی، و هزینهٔ ذخیره مطالبات مشکوک‌الوصول (غیرنقدی). نرخ سود سپرده صفر (پیش‌فرض) لایهٔ سود سپرده و نرخ نکول صفر لایهٔ ذخیره را خنثی نگه می‌دارد."
          >
            <Formula
              live={`Profit_t = AvgBal_t × ${p(config.depositProfitRate / 1200, 6)}   →   Σ = ${m(k.totalProfitPaid)}`}
            >
              Deposit Profit_t = AvgBal_t × r_dep / 12 ; AvgBal_t = (begin_t + end_t) / 2
            </Formula>
            <Formula live={`NII = ${m(k.totalIncomeInHorizon)} − ${m(k.totalProfitPaid)} = ${m(k.netInterestIncome)}`}>
              Net Interest Income = Σ Fee/Profit Collected − Σ Deposit Profit
            </Formula>
            <Formula
              live={`Provision = Σ L × ${p(config.defaultRate / 100, 4)} × ${p(config.lgdRate / 100, 4)} = ${m(k.totalProvision)}  ·  written off Σ = ${m(k.totalWriteOff)} (lag ${toFa(config.writeOffLag)}m)`}
            >
              Provision_tm = L × δ × LGD (at disbursement) ; WriteOff at tm + T_loan + lag
            </Formula>
            <Formula
              live={`Margin = ${m(k.netInterestIncome)} − ${m(k.interbankCost)} − ${m(k.totalProvision)} = ${m(k.netMargin)}   (${
                Number.isFinite(k.marginOnNetDeposit) ? `${p(k.marginOnNetDeposit * 100, 2)}% of net resources` : 'net resources = 0'
              })`}
            >
              Net Margin = NII − Interbank Funding Cost − Loan-Loss Provision
            </Formula>
          </Step>

          <Step
            letter="و"
            title="سنجه‌های مقرراتی‌مانند — LCR، NSFR و شکاف سررسید"
            desc="نسخهٔ آموزشی و قابل تنظیم از پوشش نقدینگی، تأمین مالی پایدار و میانگین وزنی عمر. ضرایب را کاربر تعیین می‌کند و این اعداد جایگزین تعاریف رسمی ناظر نیستند."
          >
            <Formula
              live={
                reg.minLcr === null
                  ? 'no month had a stressed outflow'
                  : `min LCR = ${fmtRaw(reg.minLcr, 1)}% at month ${toFa(reg.minLcrMonth ?? 0)}  ·  months < 100% = ${toFa(reg.monthsBelow100)}  ·  ω_eff = ${fmtRaw(reg.effStressRunoff, 1)}%, h = ${fmtRaw(regulatory.hqlaHaircut, 1)}%`
              }
            >
              LCR(t) = max(0, CumLiq_t) × (1 − h) / (Outflow_t + ω_eff × DepositBalance_t) × 100
            </Formula>
            <Formula
              live={
                reg.nsfr === null
                  ? `NSFR undefined at month ${toFa(reg.nsfrMonth)} (required stable funding = 0)`
                  : `NSFR(month ${toFa(reg.nsfrMonth)}) = ${m(reg.asf)} / ${m(reg.rsf)} = ${fmtRaw(reg.nsfr, 1)}%   (w = ${fmtRaw(regulatory.stableWeight, 0)}%, r = ${fmtRaw(regulatory.loanWeight, 0)}%)`
              }
            >
              NSFR(m) = DepositBalance(m) × w / (LoanBook(m) × r) × 100
            </Formula>
            <Formula
              live={
                reg.maturityGap === null
                  ? 'WAL undefined (no principal inflow or liability outflow)'
                  : `WAL assets ${fmtRaw(reg.walAssets ?? 0, 2)} − WAL liabilities ${fmtRaw(reg.walLiabilities ?? 0, 2)} = ${fmtRaw(reg.maturityGap, 2)} months`
              }
            >
              Gap = Σ t·Inflow(t)/Σ Inflow − Σ t·Outflow(t)/Σ Outflow
            </Formula>
          </Step>

          <Step
            letter="ز"
            title="انتساب حفرهٔ نقدینگی به پله‌ها"
            desc="حذف تحلیلی هر پله (بدون شبیه‌سازی مجدد): جریان‌های منتسب به آن پله از مسیر نقدینگی کم می‌شود. سود سپرده بر پایهٔ ماندهٔ هر پله توزیع می‌گردد."
          >
            <Formula
              live={
                worst
                  ? `largest hole reduction by removing «${worst.name}»: Δhole = ${m(worst.holeDelta)}`
                  : 'no tier events to attribute'
              }
            >
              cum′_k(t) = cum(t) − Σ_j≤t ncf_k(j)
            </Formula>
            <Formula live={`base hole = ${m(attr.base.maxHole)}  ·  tiers attributed = ${toFa(attr.tiers.length)}`}>
              Δhole_k = maxHole(without k) − maxHole(base)
            </Formula>
          </Step>

          <Step
            letter="ح"
            title="آزمون مونت‌کارلو — توزیع ریسک به‌جای یک عدد"
            desc="نرخ‌های رفتاری حول برآورد شما با توزیع نرمال و حجم منابع با توزیع لگ‌نرمال نمونه‌گیری می‌شوند. دانهٔ تصادفی قابل تنظیم است تا هر توزیع دقیقاً بازتولید شود."
          >
            <Formula live={`current point estimate: hole = ${m(k.maxHole)}, margin = ${m(k.netMargin)}, tipping = ${k.tippingPoint === null ? 'none' : `month ${toFa(k.tippingPoint)}`}`}>
              ρ′ = clamp(ρ + ε·σ, 0, 100) , ε ~ N(0,1) , σ = intensity × 20pp
            </Formula>
            <Formula>D′ = D × exp(ε · intensity × 0.25) ; timing shock ~ round(ε · intensity × 1.5)</Formula>
            <Formula>P(tipping) = share of runs with min CumLiq &lt; 0 ; VaR₉₅ = P95(max hole)</Formula>
          </Step>

          <Step
            letter="ط"
            title="بهینه‌یاب طراحی — جست‌وجوی مختصاتی روی اهرم‌ها"
            desc="جست‌وجوی مختصاتی چندشروعی از طرح جاری و کران‌های هر اهرم آغاز می‌شود تا در بهینهٔ محلی گیر نکند. اهرم‌ها (مقیاس α، جابه‌جایی انتظار، جابه‌جایی بازپرداخت، کج‌کردن سهم) همیشه یک‌جا روی پله‌های جاری اعمال می‌شوند. موجه بودن بر مقدار هدف اولویت دارد."
          >
            <Formula live={`baseline hole = ${m(k.maxHole)}  ·  baseline margin = ${m(k.netMargin)}  ·  leverage = ${Number.isFinite(k.leverage) ? `${fmtRatio(k.leverage)}×` : '∞'}`}>
              maximize Objective(levers) subject to the constraints you set
            </Formula>
            <Formula>levers ∈ {'{'}α-scale, ΔT_dep, ΔT_loan, tilt{'}'} ; feasible designs outrank every infeasible one</Formula>
          </Step>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <Sigma className="h-4 w-4 text-indigo-500" />
        تمام محاسبات به صورت بلادرنگ در مرورگر و با دقت ممیز شناور ۶۴ بیتی انجام می‌شود؛ نمایش به{' '}
        {factor === 10 ? 'ریال (× ۱۰)' : 'تومان'} است.
      </div>
    </Card>
  );
}

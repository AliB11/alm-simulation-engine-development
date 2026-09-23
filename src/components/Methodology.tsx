import { useState, type ReactNode } from 'react';
import { Sigma, SquareFunction } from 'lucide-react';
import type { Behavior, GlobalConfig, SimResult } from '../types';
import { fmtRaw, toFa } from '../lib/format';
import { tierColor } from '../lib/presets';
import { useDisplay } from '../context/display';
import { Card, CardHeader } from './ui';

function Step({ letter, title, desc, children }: { letter: string; title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200/80 p-4 dark:border-slate-800">
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
}

export function Methodology({ result, config, behavior }: Props) {
  const { factor, unit } = useDisplay();
  const [sel, setSel] = useState(0);
  const tr = result.tiers[Math.min(sel, Math.max(0, result.tiers.length - 1))];
  const k = result.kpis;
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
          </Step>

          <Step
            letter="ب"
            title="تعهدات و خروج همزمان سپرده (Double Liquidity Drain)"
            desc="به دلیل ممنوعیت مسدودسازی سپرده، در ماه سررسید T_dep دو رویداد خروجی همزمان رخ می‌دهد: اعطای وام و برداشت اصل سپرده."
          >
            <Formula
              live={`α_eff = min(${p(tr.tier.alpha / 100, 2)}, ${config.loanCap > 0 ? `${m(config.loanCap)} / ${m(tr.repBalance)}` : '∞'}) = ${p(tr.alphaEff, 4)}`}
            >
              α_eff = min(α , Cap / max(AvgTicket, MinBalance))
            </Formula>
            <Formula live={`L = ${m(tr.deposit)} × ${p(tr.alphaEff, 4)} × ${p(take)} × ${p(app)} = ${m(tr.commitment)}`}>
              Commitment_loan = D × α × ρ_take × ρ_app
            </Formula>
            <Formula
              live={`W = ${m(tr.deposit)} × [${p(take)}×${p(ww)} + ${p(1 - take)}×${p(wc)}] = ${m(tr.withdrawal)}`}
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
            <Formula live={`Σ Commitments = ${m(k.totalCommitment)}  |  Σ Withdrawals = ${m(k.totalWithdrawal)}`}>
              Outflows_t = Σ_k Commitment_k,t + Σ_k Withdrawal_k,t
            </Formula>
            <Formula live={`Leverage = (${m(k.totalCommitment)} + ${m(k.totalWithdrawal)}) / ${m(k.netDeposit)} = ${p(k.leverage, 3)}×`}>
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

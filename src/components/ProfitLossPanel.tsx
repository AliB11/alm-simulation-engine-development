import { useMemo, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, CardHeader, Money } from './ui';
import { Coins, Landmark, PiggyBank, Receipt } from 'lucide-react';
import type { GlobalConfig, SimResult } from '../types';
import { axisUnit, fmtNumber, fmtPct, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { cn } from '../utils/cn';

interface Datum {
  t: number;
  income: number;
  profit: number;
  funding: number;
  margin: number;
}

function Row({ label, value, color, strong }: { label: string; value: number; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span
        className={strong ? 'font-extrabold' : 'font-semibold'}
        style={{ color: strong ? (value < 0 ? '#f43f5e' : '#10b981') : undefined }}
      >
        {fmtNumber(Math.round(value))}
      </span>
    </div>
  );
}

function MarginTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Datum }> }) {
  const { unit } = useDisplay();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div
      dir="rtl"
      className="min-w-[240px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="mb-2 text-[13px] font-extrabold">ماه {toFa(d.t)}</div>
      <Row label="درآمد کارمزد/سود وصولی" value={d.income} color="#10b981" />
      <Row label="سود پرداختی سپرده" value={d.profit} color="#a855f7" />
      <Row label="هزینه تأمین کسری" value={d.funding} color="#f43f5e" />
      <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
        <Row label="حاشیهٔ تجمعی بانک" value={d.margin} strong />
      </div>
      <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'emerald' | 'violet' | 'rose';
  hint: string;
}) {
  const tones = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
    violet: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10',
    rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10',
  } as const;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5', tones[tone])}>
          {icon}
        </span>
        <span className="text-[11.5px] font-bold text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <div className="mt-1.5 text-[17px] font-black text-slate-800 dark:text-slate-100">
        <Money compact value={value} />
      </div>
      <div className="mt-0.5 text-[10.5px] leading-4 text-slate-400 dark:text-slate-500">{hint}</div>
    </div>
  );
}

/**
 * صورت سود و زیان شبیه‌سازی‌شده در افق:
 *   درآمد کارمزد/سود وصولی − سود پرداختی به سپرده‌گذاران − هزینهٔ تأمین کسری از بین‌بانکی
 * نرخ سود سپرده صفر (پیش‌فرض) این لایه را کاملاً خنثی نگه می‌دارد.
 */
export function ProfitLossPanel({ result, config }: { result: SimResult; config: GlobalConfig }) {
  const { dark, factor, unit } = useDisplay();
  const k = result.kpis;
  const horizon = Math.round(config.horizon);

  const data = useMemo<Datum[]>(
    () =>
      result.rows.map((r) => ({
        t: r.t,
        income: r.incomeIn * factor,
        profit: -r.profitPaid * factor,
        funding: -r.fundingCost * factor,
        margin: r.cumMargin * factor,
      })),
    [result.rows, factor],
  );

  const flowMax = Math.max(1, ...data.map((d) => Math.max(Math.abs(d.income), Math.abs(d.profit), Math.abs(d.funding))));
  const flowUnit = axisUnit(flowMax);
  const marginUnit = axisUnit(Math.max(1, ...data.map((d) => Math.abs(d.margin))));
  const positive = k.netMargin >= 0;

  const ticks = useMemo(() => {
    const step = horizon <= 36 ? 3 : horizon <= 72 ? 6 : 12;
    const arr: number[] = [];
    for (let t = 0; t <= horizon; t += step) arr.push(t);
    return arr;
  }, [horizon]);

  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 };

  return (
    <Card>
      <CardHeader
        icon={<Landmark />}
        title="صورت سود و زیان شبیه‌سازی‌شده"
        subtitle={`درآمد وصولی، سود پرداختی سپرده و هزینهٔ تأمین کسری در افق ${toFa(horizon)} ماهه — ارقام به ${unit}`}
        actions={
          config.depositProfitRate > 0 ? (
            <Badge tone="indigo">نرخ سود سپرده {fmtPct(config.depositProfitRate, 1)}</Badge>
          ) : (
            <Badge tone="slate">سود سپرده خنثی (۰٪)</Badge>
          )
        }
      />

      <div className="grid gap-3 p-5 pb-4 sm:grid-cols-3">
        <Tile
          icon={<Receipt />}
          tone="emerald"
          label="درآمد کارمزد / سود وصولی"
          value={k.totalIncomeInHorizon}
          hint="بخش غیراصلی اقساط وصول‌شده در افق (پس از کسر نکول)"
        />
        <Tile
          icon={<PiggyBank />}
          tone="violet"
          label="سود پرداختی به سپرده‌گذاران"
          value={k.totalProfitPaid}
          hint={`ماندهٔ پایان هر ماه × ${fmtPct(config.depositProfitRate, 1)} ÷ ۱۲`}
        />
        <Tile
          icon={<Coins />}
          tone="rose"
          label="هزینهٔ تأمین کسری نقدینگی"
          value={k.interbankCost}
          hint={`Σ کسری تجمعی × ${fmtPct(config.interbankRate, 1)} ÷ ۱۲`}
        />
      </div>

      <div
        className={cn(
          'mx-5 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4',
          positive
            ? 'bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/25'
            : 'bg-rose-50 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/25',
        )}
      >
        <div className="min-w-0">
          <div
            className={cn(
              'text-[13px] font-extrabold',
              positive ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200',
            )}
          >
            {positive ? 'حاشیهٔ خالص مثبت در پایان افق' : 'حاشیهٔ خالص منفی — محصول زیان‌ده است'}
          </div>
          <div dir="ltr" className="mt-0.5 text-left font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
            Net Margin = Fee/Profit Income − Deposit Profit − Interbank Funding Cost
          </div>
        </div>
        <div className="text-left">
          <div
            className={cn(
              'text-[26px] font-black leading-9',
              positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300',
            )}
          >
            <Money compact value={k.netMargin} />
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {Number.isFinite(k.marginOnNetDeposit)
              ? fmtPct(k.marginOnNetDeposit * 100, 2)
              : k.marginOnNetDeposit < 0
                ? '−∞'
                : '∞'}{' '}
            از منابع ورودی خالص
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-2 text-[11.5px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> درآمد وصولی (ماهانه)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> سود سپرده (ماهانه)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> هزینهٔ تأمین کسری (ماهانه)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-indigo-500" /> حاشیهٔ تجمعی (محور راست)
        </span>
        <span className="ms-auto text-[10.5px] text-slate-400">
          میله‌ها: {flowUnit.label} · خط: {marginUnit.label}
        </span>
      </div>

      <div dir="ltr" className="px-2 pb-4 sm:px-4">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 8, left: 4, bottom: 4 }} barGap={1}>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              ticks={ticks}
              tickFormatter={(v: number) => toFa(v)}
              tick={tick}
              axisLine={{ stroke: grid }}
              tickLine={false}
            />
            <YAxis
              yAxisId="flow"
              tickFormatter={(v: number) => fmtRaw(v / flowUnit.div, 1)}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={62}
            />
            <YAxis
              yAxisId="margin"
              orientation="right"
              tickFormatter={(v: number) => fmtRaw(v / marginUnit.div, 1)}
              tick={{ fill: '#6366f1', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<MarginTooltip />} cursor={{ fill: dark ? 'rgba(148,163,184,0.08)' : 'rgba(99,102,241,0.06)' }} />
            <ReferenceLine yAxisId="flow" y={0} stroke={dark ? '#64748b' : '#94a3b8'} />
            <ReferenceLine yAxisId="margin" y={0} stroke="#6366f1" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Bar yAxisId="flow" dataKey="income" stackId="s" fill="#10b981" maxBarSize={22} isAnimationActive={false} />
            <Bar yAxisId="flow" dataKey="profit" stackId="s" fill="#a855f7" maxBarSize={22} isAnimationActive={false} />
            <Bar yAxisId="flow" dataKey="funding" stackId="s" fill="#f43f5e" maxBarSize={22} isAnimationActive={false} />
            <Line
              yAxisId="margin"
              type="monotone"
              dataKey="margin"
              stroke="#6366f1"
              strokeWidth={2.2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        سود سپرده در پایان هر ماه روی <b>ماندهٔ پایان دورهٔ همان ماه</b> محاسبه می‌شود و یک خروجی نقد واقعی است؛ بنابراین هم
        بر حاشیهٔ سود و هم بر نقطهٔ واژگونی و حداکثر کسری نقدینگی اثر می‌گذارد. نرخ صفر (پیش‌فرض) این جریان را کاملاً خنثی
        می‌کند.
      </div>
    </Card>
  );
}

import { useId, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartArea, ChartColumn, ChartLine } from 'lucide-react';
import type { SimResult } from '../types';
import { axisUnit, fmtNumber, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Segmented } from './ui';

interface Datum {
  t: number;
  cum: number;
  ncf: number;
  inflow: number;
  outflow: number;
  depNet: number;
  pmt: number;
  release: number;
  loanNeg: number;
  wdNeg: number;
  depBal: number;
  loanBook: number;
}

interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Datum }>;
}

function TipRow({ label, value, color, strong }: { label: string; value: number; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className={strong ? 'font-extrabold' : 'font-semibold'} style={{ color: strong ? (value < 0 ? '#f43f5e' : '#10b981') : undefined }}>
        {fmtNumber(Math.round(value))}
      </span>
    </div>
  );
}

function CumTooltip({ active, payload }: TipProps) {
  const { unit } = useDisplay();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div dir="rtl" className="min-w-[240px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-extrabold">ماه {toFa(d.t)}</span>
        {d.cum < 0 ? <Badge tone="rose">کسری نقدینگی</Badge> : <Badge tone="emerald">مازاد نقدینگی</Badge>}
      </div>
      <TipRow label="نقدینگی تجمعی (CumLiq)" value={d.cum} strong />
      <TipRow label="خالص جریان ماه (NCF)" value={d.ncf} />
      <TipRow label="ورودی نقد" value={d.inflow} color="#10b981" />
      <TipRow label="خروجی نقد" value={d.outflow} color="#f43f5e" />
      <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[10px] text-slate-400 dark:border-slate-800">ارقام به {unit}</div>
    </div>
  );
}

function FlowTooltip({ active, payload }: TipProps) {
  const { unit } = useDisplay();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div dir="rtl" className="min-w-[250px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200">
      <div className="mb-2 text-[13px] font-extrabold">ماه {toFa(d.t)}</div>
      <TipRow label="سپرده خالص ورودی" value={d.depNet} color="#10b981" />
      <TipRow label="اقساط وصولی" value={d.pmt} color="#6366f1" />
      {d.release > 0 && <TipRow label="آزادسازی سپرده قانونی" value={d.release} color="#14b8a6" />}
      <TipRow label="تعهد اعطای وام" value={-d.loanNeg} color="#f43f5e" />
      <TipRow label="خروج سپرده" value={-d.wdNeg} color="#f59e0b" />
      <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
        <TipRow label="خالص جریان نقد (NCF)" value={d.ncf} strong />
      </div>
      <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>
    </div>
  );
}

function BalanceTooltip({ active, payload }: TipProps) {
  const { unit } = useDisplay();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div dir="rtl" className="min-w-[220px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200">
      <div className="mb-2 text-[13px] font-extrabold">ماه {toFa(d.t)}</div>
      <TipRow label="مانده سپرده‌ها" value={d.depBal} color="#0ea5e9" />
      <TipRow label="مانده تسهیلات" value={d.loanBook} color="#8b5cf6" />
      <TipRow label="نقدینگی تجمعی" value={d.cum} strong />
      <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={i.line ? 'h-0.5 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function LiquidityCharts({ result, horizon }: { result: SimResult; horizon: number }) {
  const { dark, factor, unit } = useDisplay();
  const k = result.kpis;
  const [mode, setMode] = useState<'compare' | 'components'>('compare');
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const data: Datum[] = useMemo(
    () =>
      result.rows.map((r) => ({
        t: r.t,
        cum: r.cum * factor,
        ncf: r.ncf * factor,
        inflow: r.inflow * factor,
        outflow: r.outflow * factor,
        depNet: r.depositNet * factor,
        pmt: r.pmtInflow * factor,
        release: r.reserveRelease * factor,
        loanNeg: -r.loanOut * factor,
        wdNeg: -r.withdrawalOut * factor,
        depBal: r.depositBalance * factor,
        loanBook: r.loanBook * factor,
      })),
    [result.rows, factor],
  );

  const cumMax = Math.max(0, ...data.map((d) => d.cum));
  const cumMin = Math.min(0, ...data.map((d) => d.cum));
  const off = cumMax - cumMin <= 0 ? 1 : cumMax / (cumMax - cumMin);
  const cumUnit = axisUnit(Math.max(Math.abs(cumMax), Math.abs(cumMin)));
  const flowUnit = axisUnit(Math.max(1, ...data.map((d) => Math.max(d.inflow, d.outflow))));
  const balUnit = axisUnit(Math.max(1, ...data.map((d) => Math.max(d.depBal, d.loanBook, Math.abs(d.cum)))));
  const flat = data.every((d) => Math.abs(d.cum - data[0].cum) < 1e-9);

  const ticks = useMemo(() => {
    const step = horizon <= 36 ? 3 : horizon <= 72 ? 6 : 12;
    const arr: number[] = [];
    for (let t = 0; t <= horizon; t += step) arr.push(t);
    return arr;
  }, [horizon]);

  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 };
  const zero = dark ? '#64748b' : '#94a3b8';
  const xFmt = (v: number) => toFa(v);

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      {/* Cumulative liquidity */}
      <Card className="xl:col-span-12">
        <CardHeader
          icon={<ChartArea />}
          title="روند نقدینگی تجمعی خزانه (CumLiq)"
          subtitle={`مسیر ${toFa(horizon)} ماهه مانده نقدینگی — سبز: تراز مثبت، قرمز: کسری نقدینگی · محور عمودی: ${cumUnit.label} ${unit}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {k.tippingPoint !== null ? (
                <Badge tone="rose">نقطه واژگونی: ماه {toFa(k.tippingPoint)}</Badge>
              ) : (
                <Badge tone="emerald">بدون واژگونی</Badge>
              )}
              {k.maxHole > 0 && (
                <Badge tone="rose">
                  عمیق‌ترین کسری: ماه {toFa(k.minCumMonth)}
                </Badge>
              )}
            </div>
          }
        />
        <div dir="ltr" className="px-2 pb-3 pt-4 sm:px-4">
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={data} margin={{ top: 24, right: 20, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id={`${gid}fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={0} stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset={off} stopColor="#10b981" stopOpacity={0.06} />
                  <stop offset={off} stopColor="#f43f5e" stopOpacity={0.06} />
                  <stop offset={1} stopColor="#f43f5e" stopOpacity={0.45} />
                </linearGradient>
                <linearGradient id={`${gid}stroke`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={off} stopColor="#10b981" />
                  <stop offset={off} stopColor="#f43f5e" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" ticks={ticks} tickFormatter={xFmt} tick={tick} axisLine={{ stroke: grid }} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => fmtRaw(v / cumUnit.div, 1)}
                tick={tick}
                axisLine={false}
                tickLine={false}
                width={62}
              />
              <Tooltip content={<CumTooltip />} cursor={{ stroke: '#6366f1', strokeDasharray: '4 4' }} />
              <ReferenceLine y={0} stroke={zero} strokeWidth={1.5} />
              {k.tippingPoint !== null && (
                <ReferenceLine
                  x={k.tippingPoint}
                  stroke="#f43f5e"
                  strokeDasharray="5 4"
                  label={{ value: 'نقطه واژگونی', position: 'top', fill: '#f43f5e', fontSize: 11, fontWeight: 700 }}
                />
              )}
              {k.recoveryMonth !== null && (
                <ReferenceLine
                  x={k.recoveryMonth}
                  stroke="#10b981"
                  strokeDasharray="5 4"
                  label={{ value: 'بازیابی', position: 'top', fill: '#10b981', fontSize: 11, fontWeight: 700 }}
                />
              )}
              <Area
                type="monotone"
                dataKey="cum"
                stroke={flat ? '#10b981' : `url(#${gid}stroke)`}
                strokeWidth={2.5}
                fill={`url(#${gid}fill)`}
                activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {k.maxHole > 0 && (
                <ReferenceDot
                  x={k.minCumMonth}
                  y={k.minCum * factor}
                  r={6}
                  fill="#f43f5e"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{ value: 'حداکثر کسری', position: 'right', fill: '#f43f5e', fontSize: 11, fontWeight: 700 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Inflows vs outflows */}
      <Card className="xl:col-span-8">
        <CardHeader
          icon={<ChartColumn />}
          title="ورودی‌ها در برابر خروجی‌های نقد"
          subtitle={`مقایسه ماهانه Inflows / Outflows و خط NCF · محور: ${flowUnit.label} ${unit}`}
          actions={
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'compare', label: 'مقایسه‌ای' },
                { value: 'components', label: 'تفکیک اجزا' },
              ]}
            />
          }
        />
        <div className="px-5 pt-3">
          <Legend
            items={
              mode === 'compare'
                ? [
                    { label: 'ورودی نقد', color: '#10b981' },
                    { label: 'خروجی نقد', color: '#f43f5e' },
                    { label: 'خالص جریان (NCF)', color: dark ? '#e2e8f0' : '#0f172a', line: true },
                  ]
                : [
                    { label: 'سپرده خالص', color: '#10b981' },
                    { label: 'اقساط وصولی', color: '#6366f1' },
                    { label: 'آزادسازی RR', color: '#14b8a6' },
                    { label: 'تعهد وام', color: '#f43f5e' },
                    { label: 'خروج سپرده', color: '#f59e0b' },
                    { label: 'NCF', color: dark ? '#e2e8f0' : '#0f172a', line: true },
                  ]
            }
          />
        </div>
        <div dir="ltr" className="px-2 pb-3 pt-2 sm:px-4">
          <ResponsiveContainer width="100%" height={330}>
            <ComposedChart
              key={`${mode}-${horizon}`}
              data={data}
              stackOffset="sign"
              margin={{ top: 10, right: 20, left: 4, bottom: 4 }}
              barGap={1}
            >
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" ticks={ticks} tickFormatter={xFmt} tick={tick} axisLine={{ stroke: grid }} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => fmtRaw(v / flowUnit.div, 1)}
                tick={tick}
                axisLine={false}
                tickLine={false}
                width={62}
              />
              <Tooltip
                content={<FlowTooltip />}
                cursor={{ fill: dark ? 'rgba(148,163,184,0.08)' : 'rgba(99,102,241,0.06)' }}
              />
              <ReferenceLine y={0} stroke={zero} />
              {mode === 'compare' && (
                <Bar dataKey="inflow" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
              )}
              {mode === 'compare' && (
                <Bar dataKey="outflow" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
              )}
              {mode === 'components' && (
                <Bar dataKey="depNet" stackId="s" fill="#10b981" maxBarSize={22} isAnimationActive={false} />
              )}
              {mode === 'components' && (
                <Bar dataKey="pmt" stackId="s" fill="#6366f1" maxBarSize={22} isAnimationActive={false} />
              )}
              {mode === 'components' && (
                <Bar dataKey="release" stackId="s" fill="#14b8a6" maxBarSize={22} isAnimationActive={false} />
              )}
              {mode === 'components' && (
                <Bar dataKey="loanNeg" stackId="s" fill="#f43f5e" maxBarSize={22} isAnimationActive={false} />
              )}
              {mode === 'components' && (
                <Bar dataKey="wdNeg" stackId="s" fill="#f59e0b" maxBarSize={22} isAnimationActive={false} />
              )}
              <Line
                type="monotone"
                dataKey="ncf"
                stroke={dark ? '#e2e8f0' : '#0f172a'}
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
              />
              <Brush
                dataKey="t"
                height={22}
                travellerWidth={8}
                stroke="#6366f1"
                fill={dark ? '#0f172a' : '#f8fafc'}
                tickFormatter={xFmt}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Balance sheet */}
      <Card className="xl:col-span-4">
        <CardHeader
          icon={<ChartLine />}
          title="ترازنامه شبیه‌سازی‌شده"
          subtitle={`مانده سپرده‌ها، مانده تسهیلات و نقدینگی تجمعی · ${balUnit.label} ${unit}`}
        />
        <div className="px-5 pt-3">
          <Legend
            items={[
              { label: 'مانده سپرده', color: '#0ea5e9', line: true },
              { label: 'مانده تسهیلات', color: '#8b5cf6', line: true },
              { label: 'نقدینگی تجمعی', color: '#10b981', line: true },
            ]}
          />
        </div>
        <div dir="ltr" className="px-2 pb-3 pt-2 sm:px-4">
          <ResponsiveContainer width="100%" height={330}>
            <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" ticks={ticks} tickFormatter={xFmt} tick={tick} axisLine={{ stroke: grid }} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => fmtRaw(v / balUnit.div, 0)}
                tick={tick}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip content={<BalanceTooltip />} cursor={{ stroke: '#6366f1', strokeDasharray: '4 4' }} />
              <ReferenceLine y={0} stroke={zero} />
              <Line type="stepAfter" dataKey="depBal" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="loanBook" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line
                type="monotone"
                dataKey="cum"
                stroke="#10b981"
                strokeWidth={1.8}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

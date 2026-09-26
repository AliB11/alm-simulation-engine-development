import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Wind } from 'lucide-react';
import type { SimInput } from '../types';
import { type SensMetric } from '../lib/engine';
import { higherIsBetter, isNegligible, runTornado, type TornadoBar } from '../lib/tornado';
import { axisUnit, fmtNumber, fmtPct, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Segmented } from './ui';
import { cn } from '../utils/cn';

const METRICS: { value: SensMetric; label: string; kind: 'money' | 'month' | 'ratio' }[] = [
  { value: 'maxHole', label: 'حداکثر کسری', kind: 'money' },
  { value: 'tipping', label: 'نقطه واژگونی', kind: 'month' },
  { value: 'endCum', label: 'تراز پایان افق', kind: 'money' },
  { value: 'leverage', label: 'اهرم خروج', kind: 'ratio' },
  { value: 'margin', label: 'حاشیهٔ خالص', kind: 'money' },
];

interface Datum {
  label: string;
  symbol: string;
  lowDelta: number;
  highDelta: number;
  bar: TornadoBar;
}

function formatMetric(kind: 'money' | 'month' | 'ratio', v: number, div: number): string {
  if (kind === 'month') return `ماه ${toFa(Math.round(v))}`;
  if (kind === 'ratio') return `${fmtNumber(v, 2, true)}×`;
  return fmtNumber(v / div, 1);
}

function formatDelta(kind: 'money' | 'month' | 'ratio', d: number, div: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const abs = Math.abs(d);
  if (kind === 'month') return `${sign}${toFa(Math.round(abs))} ماه`;
  if (kind === 'ratio') return `${sign}${fmtNumber(abs, 2, true)}×`;
  return `${sign}${fmtNumber(abs / div, 1)}`;
}

function TornadoTooltip({
  active,
  payload,
  kind,
  div,
  unit,
  scale,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Datum }>;
  kind: 'money' | 'month' | 'ratio';
  div: number;
  unit: string;
  /** ضریب تبدیل تومان به واحد نمایش — برای سنجه‌های پولی */
  scale: number;
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  const b = d.bar;
  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <b className="tabular-nums">{value}</b>
    </div>
  );
  return (
    <div
      dir="rtl"
      className="min-w-[240px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="mb-1.5 text-[13px] font-extrabold">
        {b.label} <span dir="ltr" className="font-mono text-[11px] text-slate-400">{b.symbol}</span>
      </div>
      {row('مقدار جاری', `${fmtRaw(b.current, 1)}٪`)}
      {row('کران پایین', `${fmtRaw(b.low, 1)}٪`)}
      {row('کران بالا', `${fmtRaw(b.high, 1)}٪`)}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      {row('سنجه در طراحی فعال', formatMetric(kind, b.base * scale, div))}
      {row(`سنجه در ${fmtRaw(b.low, 1)}٪`, formatMetric(kind, b.lowValue * scale, div))}
      {row(`سنجه در ${fmtRaw(b.high, 1)}٪`, formatMetric(kind, b.highValue * scale, div))}
      <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
        {row('دامنهٔ نوسان (swing)', formatDelta(kind, b.swing * scale, div))}
      </div>
      {kind === 'money' && <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>}
    </div>
  );
}

/**
 * نمودار گردبادی (Tornado) — رتبه‌بندی محرک‌های ریسک.
 *
 * هر میله یک متغیر ریسک است که به‌تنهایی بین دو کران شبکهٔ آزمون بحران
 * تکان داده شده؛ طول میله نشان می‌دهد آن متغیر چقدر سنجهٔ انتخابی را
 * جابه‌جا می‌کند. این مکمل ماتریس دوبعدی است: ماتریس «ترکیب» دو متغیر را
 * نشان می‌دهد و گردباد «اولویت» همهٔ متغیرها را.
 */
export function TornadoPanel({ input }: { input: SimInput }) {
  const { dark, factor, unit } = useDisplay();
  const [metric, setMetric] = useState<SensMetric>('maxHole');

  const result = useMemo(() => runTornado(input, metric), [input, metric]);
  const metricDef = METRICS.find((m) => m.value === metric) ?? METRICS[0];
  const scale = metricDef.kind === 'money' ? factor : 1;

  const data = useMemo<Datum[]>(
    () =>
      result.bars.map((bar) => ({
        label: bar.label,
        symbol: bar.symbol,
        lowDelta: bar.lowDelta * scale,
        highDelta: bar.highDelta * scale,
        bar,
      })),
    [result.bars, scale],
  );

  const swingMax = Math.max(1e-9, ...data.map((d) => Math.max(Math.abs(d.lowDelta), Math.abs(d.highDelta))));
  const swingUnit = axisUnit(swingMax);
  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 };
  const better = higherIsBetter(metric);

  const cellColor = (delta: number) => {
    const good = better ? delta > 0 : delta < 0;
    return good ? '#10b981' : '#f43f5e';
  };

  return (
    <Card>
      <CardHeader
        icon={<Wind />}
        title="نمودار گردبادی محرک‌های ریسک (Tornado)"
        subtitle="هر متغیر به‌تنهایی بین دو کران شبکهٔ آزمون بحران تکان داده می‌شود؛ میلهٔ بلندتر یعنی آن محرک اثر بزرگ‌تری بر سنجه دارد"
        actions={
          <>
            <Badge tone="slate">
              {toFa(result.evaluations)} شبیه‌سازی · {toFa(result.bars.length)} محرک
            </Badge>
            <Segmented size="sm" className="flex-wrap" value={metric} onChange={setMetric} options={METRICS} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-100 px-5 py-3 text-[11.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="font-semibold">
          سنجهٔ فعال: <span className="text-slate-700 dark:text-slate-200">{metricDef.label}</span> · مقدار در طراحی فعال{' '}
          <b className="tabular-nums">{formatMetric(metricDef.kind, result.base * scale, swingUnit.div)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> حرکت به سمت بهتر
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> حرکت به سمت بدتر
        </span>
        <span className="ms-auto text-[10.5px] text-slate-400">
          {metricDef.kind === 'money' ? `محور افقی: ${swingUnit.label} ${unit}` : 'محور افقی: اختلاف با طراحی فعال'}
        </span>
      </div>

      <div dir="ltr" className="px-2 py-3 sm:px-4">
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38 + 40)}>
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barGap={2}>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => fmtRaw(v / swingUnit.div, 1)}
              tick={tick}
              axisLine={{ stroke: grid }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={168}
              tick={{ fill: dark ? '#cbd5e1' : '#334155', fontSize: 11.5 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<TornadoTooltip kind={metricDef.kind} div={swingUnit.div} unit={unit} scale={scale} />}
              cursor={{ fill: dark ? 'rgba(148,163,184,0.08)' : 'rgba(99,102,241,0.06)' }}
            />
            <ReferenceLine x={0} stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth={1.5} />
            <Bar dataKey="lowDelta" name="کران پایین" maxBarSize={14} isAnimationActive={false} radius={[0, 3, 3, 0]}>
              {data.map((d) => (
                <Cell key={`lo-${d.symbol}`} fill={cellColor(d.lowDelta)} fillOpacity={0.55} />
              ))}
            </Bar>
            <Bar dataKey="highDelta" name="کران بالا" maxBarSize={14} isAnimationActive={false} radius={[0, 3, 3, 0]}>
              {data.map((d) => (
                <Cell key={`hi-${d.symbol}`} fill={cellColor(d.highDelta)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
        <table className="w-full min-w-[720px] border-collapse text-right text-[11.5px]">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">رتبه</th>
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">محرک ریسک</th>
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">بازهٔ آزمون</th>
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">سنجه در کران پایین</th>
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">سنجه در کران بالا</th>
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">دامنهٔ نوسان</th>
              <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">سهم از کل نوسان</th>
            </tr>
          </thead>
          <tbody>
            {result.bars.map((b, i) => {
              const total = result.bars.reduce((s, x) => s + x.swing, 0);
              const share = total > 0 ? (b.swing / total) * 100 : 0;
              const negligible = isNegligible(b, result.base);
              return (
                <tr
                  key={b.key}
                  className={cn(
                    'border-b border-slate-100 last:border-0 dark:border-slate-800/70',
                    negligible && 'opacity-50',
                  )}
                >
                  <td className="px-3 py-2 font-black text-slate-400">{toFa(i + 1)}</td>
                  <td className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">
                    {b.label} <span dir="ltr" className="font-mono text-[10.5px] text-slate-400">{b.symbol}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                    {fmtRaw(b.low, 1)} ← {fmtRaw(b.current, 1)} → {fmtRaw(b.high, 1)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatMetric(metricDef.kind, b.lowValue * scale, swingUnit.div)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMetric(metricDef.kind, b.highValue * scale, swingUnit.div)}</td>
                  <td className="px-3 py-2 font-bold tabular-nums">
                    {formatDelta(metricDef.kind, b.swing * scale, swingUnit.div)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtPct(share, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        هر میله یک شبیه‌سازی کامل است و فقط همان متغیر تغییر می‌کند؛ پس اثر تعاملی دو متغیر اینجا دیده نمی‌شود و برای
        آن باید از ماتریس دوبعدی بالای همین بخش استفاده کرد. کران‌ها دقیقاً همان مقادیر شبکهٔ آزمون بحران‌اند، بنابراین
        نتیجهٔ این جدول با خانه‌های ماتریس سازگار است. «نقطهٔ واژگونی ندارد» به‌عنوان یک ماه پس از افق لحاظ می‌شود تا
        امن‌ترین حالت بزرگ‌ترین عدد باشد؛ محرک‌های کم‌اثر در جدول کم‌رنگ‌تر نمایش داده می‌شوند.
      </div>
    </Card>
  );
}

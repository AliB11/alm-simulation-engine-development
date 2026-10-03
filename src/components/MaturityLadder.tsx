import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Layers3, TableProperties } from 'lucide-react';
import type { GlobalConfig, SimResult } from '../types';
import type { Regulatory } from '../lib/regulatory';
import type { AttributionResult } from '../lib/attribution';
import { axisUnit, fmtCompact, fmtNumber, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Segmented } from './ui';
import { cn } from '../utils/cn';

interface Props {
  result: SimResult;
  config: GlobalConfig;
  /** سنجه‌ها و انتساب پله‌ها در ریشهٔ برنامه یک‌بار محاسبه و به هر دو کارت پاس داده می‌شوند */
  reg: Regulatory;
  attr: AttributionResult;
}

type View = 'ladder' | 'paths';

interface PathEntry {
  dataKey?: string | number;
  name?: string;
  value?: number;
  color?: string;
  stroke?: string;
}

function PathsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<PathEntry>;
  label?: number;
}) {
  const { unit } = useDisplay();
  if (!active || !payload?.length) return null;
  const entries = payload.filter((p) => Number.isFinite(Number(p.value)));
  const base = entries.find((p) => p.dataKey === 'base');
  const others = entries.filter((p) => p.dataKey !== 'base');
  return (
    <div
      dir="rtl"
      className="max-h-[320px] min-w-[240px] overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="mb-1.5 text-[13px] font-extrabold">ماه {toFa(label ?? 0)}</div>
      {base && (
        <div className="mb-1 flex items-center justify-between gap-4 border-b border-slate-100 pb-1 dark:border-slate-800">
          <span className="flex items-center gap-1.5 font-bold">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            طرح جاری
          </span>
          <b className="tabular-nums">{fmtCompact(Number(base.value))}</b>
        </div>
      )}
      {others.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.stroke ?? '#94a3b8' }} />
            {p.name}
          </span>
          <b className="tabular-nums">{fmtCompact(Number(p.value))}</b>
        </div>
      ))}
      <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>
    </div>
  );
}

interface LadderDatum {
  label: string;
  inflow: number;
  outflow: number;
  cumNet: number;
}

function LadderTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: LadderDatum }> }) {
  const { unit } = useDisplay();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  const row = (label: string, value: number, color?: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <b className="tabular-nums">{fmtCompact(value)}</b>
    </div>
  );
  return (
    <div
      dir="rtl"
      className="min-w-[230px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="mb-1.5 text-[13px] font-extrabold">ماه {toFa(d.label)}</div>
      {row('بازگشت اصل سرمایه (دارایی)', d.inflow, '#10b981')}
      {row('خروج سپرده + سود (تعهد)', d.outflow, '#f43f5e')}
      <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
        {row('شکاف تجمعی سررسید', d.cumNet, '#6366f1')}
      </div>
      <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>
    </div>
  );
}

/**
 * نردبان سررسید: چه زمانی اصل سرمایه برمی‌گردد و چه زمانی سپرده‌ها خارج
 * می‌شوند، به تفکیک بازهٔ زمانی و پله. به‌همراه انتساب تحلیلی حفرهٔ
 * نقدینگی به هر پله (بدون شبیه‌سازی مجدد).
 */
export function MaturityLadder({ result, config, reg, attr }: Props) {
  const { dark, factor, unit } = useDisplay();
  const [view, setView] = useState<View>('ladder');
  const horizon = Math.round(config.horizon);

  const ladderData = useMemo<LadderDatum[]>(
    () =>
      reg.buckets.map((b) => ({
        label: b.label,
        inflow: b.inflow * factor,
        outflow: b.outflow * factor,
        cumNet: b.cumNet * factor,
      })),
    [reg.buckets, factor],
  );
  const flowUnit = axisUnit(Math.max(1, ...ladderData.map((d) => Math.max(Math.abs(d.inflow), Math.abs(d.outflow)))));
  const cumUnit = axisUnit(Math.max(1, ...ladderData.map((d) => Math.abs(d.cumNet))));

  const heatMax = Math.max(1, ...attr.heat.cells.flat());
  const heatUnit = axisUnit(heatMax * factor);
  const pathData = useMemo(() => {
    const shown = attr.tiers.slice(0, 8);
    return result.rows.map((r, i) => {
      const point: Record<string, number> = { t: r.t, base: r.cum * factor };
      for (const tier of shown) point[`tier:${tier.tierId}`] = (tier.cumWithout[i] ?? 0) * factor;
      return point;
    });
  }, [attr.tiers, result.rows, factor]);
  const pathUnit = axisUnit(Math.max(1, ...pathData.map((p) => Math.abs(p.base))));

  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 };

  const worst = attr.tiers.reduce(
    (acc, t) => (acc === null || t.holeDelta < acc.holeDelta ? t : acc),
    null as (typeof attr.tiers)[number] | null,
  );

  return (
    <Card>
      <CardHeader
        icon={<Layers3 />}
        title="نردبان سررسید و انتساب ریسک به پله‌ها"
        subtitle={`بازگشت اصل سرمایه در برابر خروج سپرده‌ها در بازه‌های ${toFa(reg.bucketSize)} ماهه — و اینکه حذف هر پله چه اثری بر حفرهٔ نقدینگی دارد`}
        actions={
          <>
            {worst && worst.holeDelta < 0 && (
              <Badge tone="rose">
                بیشترین اثر منفی: {worst.name}
              </Badge>
            )}
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'ladder', label: 'ستون‌های نردبان', icon: <TableProperties /> },
                { value: 'paths', label: 'مسیر حذف پله‌ها' },
              ]}
            />
          </>
        }
      />

      {view === 'ladder' ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pt-4 text-[11.5px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> بازگشت اصل سرمایه از تسهیلات
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> خروج سپرده و سود پرداختی
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-indigo-500" /> شکاف تجمعی سررسید (محور راست)
            </span>
            <span className="ms-auto text-[10.5px] text-slate-400">
              میله‌ها: {flowUnit.label} · خط: {cumUnit.label}
            </span>
          </div>
          <div dir="ltr" className="px-2 pb-2 sm:px-4">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={ladderData} margin={{ top: 10, right: 8, left: 4, bottom: 4 }} barGap={2}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickFormatter={(v: string) => toFa(v)} tick={tick} axisLine={{ stroke: grid }} tickLine={false} />
                <YAxis
                  yAxisId="flow"
                  tickFormatter={(v: number) => fmtRaw(v / flowUnit.div, 1)}
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                />
                <YAxis
                  yAxisId="cum"
                  orientation="right"
                  tickFormatter={(v: number) => fmtRaw(v / cumUnit.div, 1)}
                  tick={{ fill: '#6366f1', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <Tooltip content={<LadderTooltip />} cursor={{ fill: dark ? 'rgba(148,163,184,0.08)' : 'rgba(99,102,241,0.06)' }} />
                <ReferenceLine yAxisId="cum" y={0} stroke="#6366f1" strokeDasharray="4 4" strokeOpacity={0.5} />
                <Bar yAxisId="flow" dataKey="inflow" fill="#10b981" maxBarSize={26} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="flow" dataKey="outflow" fill="#f43f5e" maxBarSize={26} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                <Line
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumNet"
                  stroke="#6366f1"
                  strokeWidth={2.2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto border-t border-slate-100 p-5 dark:border-slate-800">
            <div className="mb-2 text-[12px] font-extrabold text-slate-700 dark:text-slate-200">
              نقشهٔ حرارتی خروج پله‌ها در زمان
            </div>
            <table className="w-full border-collapse text-[10.5px]">
              <caption className="sr-only">نقشهٔ حرارتی خروج پله‌ها در زمان</caption>
              <thead>
                <tr>
                  <th className="sticky right-0 z-10 bg-white px-2 py-1.5 text-right font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    پله
                  </th>
                  {attr.heat.bucketLabels.map((l) => (
                    <th key={l} className="px-1 py-1.5 text-center font-semibold tabular-nums text-slate-400">
                      {toFa(l)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attr.tiers.map((t, i) => (
                  <tr key={t.tierId}>
                    <td className="sticky right-0 z-10 whitespace-nowrap bg-white px-2 py-1 text-right font-bold dark:bg-slate-900">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                        {t.name}
                      </span>
                    </td>
                    {attr.heat.cells[i].map((v, b) => (
                      <td
                        key={b}
                        title={`ماه ${attr.heat.bucketLabels[b]} — ${fmtCompact(v * factor)}`}
                        className="h-6 border border-slate-100 text-center tabular-nums dark:border-slate-800"
                        style={{
                          background: v > 0 ? `${t.color}${Math.round(18 + (v / heatMax) * 200).toString(16).padStart(2, '0')}` : undefined,
                          color: v / heatMax > 0.45 ? '#fff' : undefined,
                        }}
                      >
                        {v > 0 ? fmtRaw((v * factor) / heatUnit.div, 0) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1.5 text-[10.5px] text-slate-400">
              شدت رنگ نشان‌دهندهٔ بزرگی خروج (برداشت اصل + سهم سود سپرده) در آن بازه است؛ ارقام سلول‌ها به{' '}
              {heatUnit.label || unit} و راهنمای هر سلول به {unit} نمایش داده می‌شود.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pt-4 text-[11.5px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-slate-400" /> طرح جاری (پایه)
            </span>
            {attr.tiers.slice(0, 8).map((t) => (
              <span key={t.tierId} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                بدون {t.name}
              </span>
            ))}
            {attr.tiers.length > 8 && (
              <span className="text-[10.5px] text-slate-400">
                +{toFa(attr.tiers.length - 8)} پلهٔ دیگر (فقط در جدول پایین)
              </span>
            )}
            <span className="ms-auto text-[10.5px] text-slate-400">محور: {pathUnit.label}</span>
          </div>
          <div dir="ltr" className="px-2 pb-3 sm:px-4">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={pathData} margin={{ top: 10, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  ticks={(() => {
                    const step = horizon <= 36 ? 3 : horizon <= 72 ? 6 : 12;
                    const arr: number[] = [];
                    for (let t = 0; t <= horizon; t += step) arr.push(t);
                    return arr;
                  })()}
                  tickFormatter={(v: number) => toFa(v)}
                  tick={tick}
                  axisLine={{ stroke: grid }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => fmtRaw(v / pathUnit.div, 1)}
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                />
                <Tooltip content={<PathsTooltip />} cursor={{ stroke: dark ? '#475569' : '#cbd5e1' }} />
                <ReferenceLine y={0} stroke={dark ? '#64748b' : '#94a3b8'} />
                <Line type="monotone" dataKey="base" name="طرح جاری" stroke="#94a3b8" strokeWidth={2.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                {attr.tiers.slice(0, 8).map((t) => (
                  <Line
                    key={t.tierId}
                    type="monotone"
                    dataKey={`tier:${t.tierId}`}
                    name={`بدون ${t.name}`}
                    stroke={t.color}
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
        <table className="w-full min-w-[860px] border-collapse text-right text-[12px]">
          <caption className="sr-only">نردبان سررسید و انتساب ریسک به پله‌ها</caption>
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">پله</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">سپردهٔ ورودی</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">برداشت</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">وام پرداختی</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">اقساط وصولی</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">حفرهٔ بدون این پله</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">Δ حفره</th>
              <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">واژگونی بدون این پله</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100 bg-slate-50/60 font-bold dark:border-slate-800 dark:bg-slate-900/40">
              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">طرح جاری (پایه)</td>
              <td className="px-3 py-2 tabular-nums" colSpan={4}>
                حفرهٔ پایه: {fmtCompact(attr.base.maxHole * factor)} ·{' '}
                {attr.base.tipping === null ? 'بدون واژگونی' : `واژگونی در ماه ${toFa(attr.base.tipping)}`}
              </td>
              <td className="px-3 py-2 tabular-nums">{fmtCompact(attr.base.maxHole * factor)}</td>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">
                {attr.base.tipping === null ? 'بدون واژگونی' : `ماه ${toFa(attr.base.tipping)}`}
              </td>
            </tr>
            {attr.tiers.map((t) => (
              <tr key={t.tierId} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtCompact(t.deposit * factor)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtCompact(t.withdrawal * factor)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtCompact(t.loan * factor)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtCompact(t.pmt * factor)}</td>
                <td className="px-3 py-2 font-bold tabular-nums">{fmtCompact(t.maxHoleWithout * factor)}</td>
                <td
                  className={cn(
                    'px-3 py-2 font-bold tabular-nums',
                    t.holeDelta < -1 ? 'text-emerald-600 dark:text-emerald-400' : t.holeDelta > 1 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400',
                  )}
                >
                  {t.holeDelta > 0 ? '+' : ''}
                  {fmtCompact(t.holeDelta * factor)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {t.tippingWithout === null ? (
                    <span className={attr.base.tipping !== null ? 'font-bold text-emerald-600 dark:text-emerald-400' : ''}>
                      بدون واژگونی
                    </span>
                  ) : (
                    <>
                      ماه {toFa(t.tippingWithout)}
                      {attr.base.tipping !== null && Number.isFinite(t.tippingDelta ?? NaN) && (t.tippingDelta ?? 0) !== 0 && (
                        <span
                          className={cn(
                            'ms-1.5 text-[10.5px] font-bold',
                            (t.tippingDelta ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          ({(t.tippingDelta ?? 0) > 0 ? '+' : ''}
                          {fmtNumber(t.tippingDelta ?? 0)})
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 px-5 py-3.5 text-[11px] leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        انتساب به روش تحلیلی انجام می‌شود و نیازی به شبیه‌سازی مجدد ندارد: اگر پلهٔ <b>k</b> به‌طور کامل حذف شود (نه
        منابعش وارد شود، نه وامش پرداخت شود و نه برداشت و اقساطش)، نقدینگی تجمعی جدید برابر است با{' '}
        <span dir="ltr" className="font-mono">
          cum′(t) = cum(t) − Σ<sub>j≤t</sub> ncf<sub>k</sub>(j)
        </span>
        . سود پرداختی سپرده یک جریان سطح‌پرتفوی است و بر پایهٔ ماندهٔ رویدادمحور هر پله (ورودی منهای برداشت) به آن
        نسبت داده می‌شود. <b>Δ حفرهٔ منفی</b> یعنی حذف آن پله، نقدینگی را بهبود می‌دهد — یعنی آن پله منبع اصلی فشار
        نقدینگی است.
        {attr.unattributedProfit > 0 && (
          <>
            {' '}
            سود منتسب‌نشده (سپردهٔ بدون تخصیص پله): {fmtCompact(attr.unattributedProfit * factor)} {unit}
          </>
        )}
      </div>
    </Card>
  );
}

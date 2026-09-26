import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookmarkPlus, GitCompareArrows, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { MonthRow, SimKpis } from '../types';
import {
  configDiffs,
  kpiValue,
  KPI_ROWS,
  simulateSlot,
  SLOT_IDS,
  SLOT_META,
  type ScenarioSlot,
  type ScenarioSlots,
  type SlotId,
} from '../lib/scenarios';
import { axisUnit, fmtCompact, fmtNumber, fmtRatio, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Button, Card, CardHeader, IconButton, Money } from './ui';
import { cn } from '../utils/cn';

interface Props {
  kpis: SimKpis;
  /** ردیف‌های جاری — از شبیه‌سازی اصلی برنامه می‌آید تا دوباره‌کاری نشود */
  currentRows: MonthRow[];
  slots: ScenarioSlots;
  onSnapshot: (id: SlotId) => void;
  onLoad: (id: SlotId) => void;
  onClear: (id: SlotId) => void;
  onRename: (id: SlotId, name: string) => void;
}

interface SlotSim {
  id: SlotId;
  slot: ScenarioSlot;
  kpis: SimKpis;
  rows: { t: number; cum: number }[];
}

function formatDelta(kind: string, d: number): string {
  const sign = d > 0 ? '+' : '';
  switch (kind) {
    case 'money':
      return `${sign}${fmtCompact(d)}`;
    case 'ratio':
      return `${sign}${fmtNumber(d, 2)}×`;
    case 'month':
      return `${sign}${fmtNumber(Math.round(d))} ماه`;
    case 'count':
      return `${sign}${fmtNumber(Math.round(d))}`;
    default:
      return `${sign}${fmtNumber(d, 1)}`;
  }
}

function formatKpi(kind: string, v: number | null): string {
  if (v === null) return '—';
  switch (kind) {
    case 'month':
      return `ماه ${toFa(Math.round(v))}`;
    case 'count':
      return fmtNumber(Math.round(v));
    case 'ratio':
      return `${fmtRatio(v)}×`;
    case 'pct':
      return `${fmtNumber(v, 1)}٪`;
    default:
      return fmtCompact(v);
  }
}

function SlotTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string | number; name?: string; value?: number; color?: string; stroke?: string }>;
  label?: number;
}) {
  const { unit } = useDisplay();
  if (!active || !payload?.length) return null;
  return (
    <div
      dir="rtl"
      className="min-w-[210px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="mb-1.5 text-[13px] font-extrabold">ماه {toFa(label ?? 0)}</div>
      {payload
        .filter((p) => Number.isFinite(Number(p.value)))
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.stroke ?? '#94a3b8' }} />
              {p.name}
            </span>
            <b className="tabular-nums">{fmtCompact(Number(p.value))}</b>
          </div>
        ))}
      <div className="mt-1 text-[10px] text-slate-400">نقدینگی تجمعی به {unit}</div>
    </div>
  );
}

/**
 * مقایسهٔ سناریو A/B/C — سه جایگاه برای عکس‌برداری از طرح کامل و سنجش
 * تفاوت سنجه‌ها و مسیر نقدینگی آن‌ها کنار هم.
 */
export function ScenarioCompare({ kpis, currentRows, slots, onSnapshot, onLoad, onClear, onRename }: Props) {
  const { dark, factor, unit } = useDisplay();

  const sims = useMemo<SlotSim[]>(() => {
    const out: SlotSim[] = [];
    for (const id of SLOT_IDS) {
      const slot = slots[id];
      if (!slot) continue;
      const res = simulateSlot(slot);
      out.push({ id, slot, kpis: res.kpis, rows: res.rows.map((r) => ({ t: r.t, cum: r.cum })) });
    }
    return out;
  }, [slots]);

  const reference = sims[0] ?? null;

  const mergedData = useMemo(() => {
    const maxH = Math.max(currentRows.length, ...sims.map((s) => s.rows.length));
    return Array.from({ length: maxH }, (_, i) => {
      const point: Record<string, number> = { t: i };
      for (const s of sims) {
        const row = s.rows[i];
        if (row) point[s.id] = row.cum * factor;
      }
      const cur = currentRows[i];
      if (cur) point.current = cur.cum * factor;
      return point;
    });
  }, [sims, currentRows, factor]);

  const cumUnit = axisUnit(
    Math.max(1, ...mergedData.flatMap((d) => SLOT_IDS.map((id) => Math.abs(Number(d[id]) || 0))), ...currentRows.map((r) => Math.abs(r.cum * factor))),
  );
  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 };
  const diffs = sims.length >= 2 ? configDiffs(sims[0].slot, sims[1].slot) : [];

  return (
    <Card>
      <CardHeader
        icon={<GitCompareArrows />}
        title="مقایسهٔ سناریوها (A / B / C)"
        subtitle="طرح کامل را در یک جایگاه ذخیره کنید، پارامترها را تغییر دهید و پیامد تفاوت‌ها را سنجه‌به‌سنجه ببینید"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {SLOT_IDS.map((id) => (
              <Button
                key={id}
                size="sm"
                variant={slots[id] ? 'ghost' : 'secondary'}
                onClick={() => onSnapshot(id)}
                title={slots[id] ? `جایگزینی جایگاه ${id} با سناریوی جاری` : `ذخیرهٔ سناریوی جاری در جایگاه ${id}`}
              >
                {slots[id] ? <Save /> : <BookmarkPlus />}
                {slots[id] ? 'به‌روزرسانی' : 'ذخیره در'} {id}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 p-5 lg:grid-cols-3">
        {SLOT_IDS.map((id) => {
          const sim = sims.find((s) => s.id === id);
          const meta = SLOT_META[id];
          if (!sim) {
            return (
              <div
                key={id}
                className="flex min-h-[190px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center dark:border-slate-700 dark:bg-slate-950/40"
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-black text-white"
                  style={{ background: meta.color }}
                >
                  {id}
                </span>
                <div className="text-[12.5px] font-bold text-slate-600 dark:text-slate-300">جایگاه {id} خالی است</div>
                <p className="text-[11px] leading-5 text-slate-400">
                  پس از تنظیم طرح، «ذخیره در {id}» را بزنید تا پیکربندی، پله‌ها، رفتار و زمان‌بندی منابع همراه سنجه‌ها
                  ثبت شود.
                </p>
              </div>
            );
          }
          const k = sim.kpis;
          return (
            <div
              key={id}
              className="rounded-xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/60"
              style={{ boxShadow: `inset 3px 0 0 ${meta.color}` }}
            >
              <div className="flex items-start justify-between gap-2">
                <input
                  value={sim.slot.name}
                  onChange={(e) => onRename(id, e.target.value)}
                  onBlur={() => {
                    if (!sim.slot.name.trim()) onRename(id, SLOT_META[id].label);
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] font-extrabold text-slate-700 outline-none transition hover:border-slate-200 focus:border-indigo-300 dark:text-slate-200 dark:hover:border-slate-700 dark:focus:border-indigo-500"
                  aria-label={`نام سناریوی ${id}`}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton title="بارگذاری این سناریو در برنامه" onClick={() => onLoad(id)}>
                    <RotateCcw />
                  </IconButton>
                  <IconButton title="حذف این جایگاه" onClick={() => onClear(id)}>
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
              <div className="mt-0.5 px-1.5 text-[10.5px] text-slate-400">
                {new Date(sim.slot.savedAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                {toFa(sim.slot.tiers.length)} پله · افق {toFa(Math.round(sim.slot.config.horizon))} ماه
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 px-1.5 text-[11.5px]">
                <span className="text-slate-500 dark:text-slate-400">حداکثر کسری</span>
                <b className="text-left tabular-nums">
                  <Money compact value={k.maxHole} />
                </b>
                <span className="text-slate-500 dark:text-slate-400">حاشیهٔ خالص</span>
                <b className={cn('text-left tabular-nums', k.netMargin < 0 && 'text-rose-600 dark:text-rose-400')}>
                  <Money compact value={k.netMargin} />
                </b>
                <span className="text-slate-500 dark:text-slate-400">واژگونی</span>
                <b className="text-left">{k.tippingPoint === null ? 'بدون' : `ماه ${toFa(k.tippingPoint)}`}</b>
                <span className="text-slate-500 dark:text-slate-400">اهرم خروج</span>
                <b className="text-left tabular-nums">{fmtRatio(k.leverage)}×</b>
              </div>

              {reference && reference.id !== id && (
                <div className="mt-2.5 border-t border-slate-100 px-1.5 pt-2 text-[10.5px] leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  نسبت به {SLOT_META[reference.id].label}: حفره{' '}
                  <b className={k.maxHole < reference.kpis.maxHole ? 'text-emerald-600 dark:text-emerald-400' : k.maxHole > reference.kpis.maxHole ? 'text-rose-600 dark:text-rose-400' : ''}>
                    {fmtCompact((k.maxHole - reference.kpis.maxHole) * factor)}
                  </b>{' '}
                  · حاشیه{' '}
                  <b className={k.netMargin > reference.kpis.netMargin ? 'text-emerald-600 dark:text-emerald-400' : k.netMargin < reference.kpis.netMargin ? 'text-rose-600 dark:text-rose-400' : ''}>
                    {fmtCompact((k.netMargin - reference.kpis.netMargin) * factor)}
                  </b>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sims.length > 0 && (
        <>
          <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
            <table className="w-full min-w-[640px] border-collapse text-right text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">سنجه</th>
                  {sims.map((s) => (
                    <th key={s.id} className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: SLOT_META[s.id].color }} />
                        {s.slot.name}
                      </span>
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">سناریوی جاری</th>
                </tr>
              </thead>
              <tbody>
                {KPI_ROWS.map((row) => {
                  const refValue = reference ? kpiValue(reference.kpis, row.key) : null;
                  const scale = row.kind === 'money' ? factor : 1;
                  return (
                    <tr key={row.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                      <td className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">{row.label}</td>
                      {sims.map((s) => {
                        const v = kpiValue(s.kpis, row.key);
                        const delta = v !== null && refValue !== null && s.id !== reference?.id ? v - refValue : null;
                        const good =
                          delta === null || Math.abs(delta) < 1e-9 ? null : row.lowerIsBetter ? delta < 0 : delta > 0;
                        return (
                          <td key={s.id} className="px-3 py-2 tabular-nums">
                            <span className="font-bold">{formatKpi(row.kind, v === null ? null : v * scale)}</span>
                            {delta !== null && Math.abs(delta) > 1e-9 && (
                              <span
                                className={cn(
                                  'ms-1.5 text-[10.5px] font-bold',
                                  good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                                )}
                              >
                                ({formatDelta(row.kind, delta * scale)})
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                        {(() => {
                          const v = kpiValue(kpis, row.key);
                          return formatKpi(row.kind, v === null ? null : v * scale);
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {diffs.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              <div className="mb-1.5 text-[11.5px] font-extrabold text-slate-600 dark:text-slate-300">
                تفاوت ورودی‌های {SLOT_META[sims[0].id].label} و {SLOT_META[sims[1].id].label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {diffs.map((d) => (
                  <Badge key={d} tone="indigo">
                    {d}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 px-5 pt-4 text-[11.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {sims.map((s) => (
              <span key={s.id} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SLOT_META[s.id].color }} />
                {s.slot.name}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-slate-400" /> سناریوی جاری
            </span>
            <span className="ms-auto text-[10.5px] text-slate-400">محور عمودی: {cumUnit.label || unit}</span>
          </div>
          <div dir="ltr" className="px-2 pb-4 pt-1 sm:px-4">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={mergedData} margin={{ top: 10, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={(v: number) => toFa(v)}
                  tick={tick}
                  axisLine={{ stroke: grid }}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  tickFormatter={(v: number) => fmtRaw(v / cumUnit.div, 1)}
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                />
                <Tooltip content={<SlotTooltip />} cursor={{ stroke: dark ? '#475569' : '#cbd5e1' }} />
                <ReferenceLine y={0} stroke={dark ? '#64748b' : '#94a3b8'} />
                {sims.map((s) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.slot.name}
                    stroke={SLOT_META[s.id].color}
                    strokeWidth={2.2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="current"
                  name="سناریوی جاری"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        جایگاه‌ها در حافظهٔ مرورگر شما نگه داشته می‌شوند و با بارگذاری مجدد صفحه از بین نمی‌روند. سنجه‌های جدول در لحظهٔ
        نمایش با موتور شبیه‌سازی <b>دوباره محاسبه</b> می‌شوند تا همیشه با نسخهٔ جاری موتور سازگار باشند؛ مرجع مقایسهٔ
        تفاضل‌ها نخستین جایگاه پُر است. برای جابه‌جایی کامل بین سناریوها، دکمهٔ «بارگذاری» هر کارت را بزنید. ضرایب
        LCR/NSFR تنظیمات تحلیل‌اند و با تعویض سناریو عوض نمی‌شوند.
      </div>
    </Card>
  );
}

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, Download, ListFilter, Table2 } from 'lucide-react';
import type { EventType, FlowEvent, GlobalConfig, MonthRow, SimResult } from '../types';
import { EPS } from '../lib/engine';
import { fmtNumber, fmtPct, toFa } from '../lib/format';
import { tierColor } from '../lib/presets';
import { useDisplay } from '../context/display';
import { Badge, Button, Card, CardHeader, NumField, Segmented } from './ui';
import { cn } from '../utils/cn';

type Filter = 'all' | 'deficit' | 'negNcf' | 'events';
type Scale = 'full' | 'm' | 'b';

const EVENT_META: Record<EventType, { label: string; sign: 1 | -1; color: string }> = {
  deposit: { label: 'ورود سپرده جدید', sign: 1, color: '#10b981' },
  reserve: { label: 'کسر سپرده قانونی (RR)', sign: -1, color: '#94a3b8' },
  release: { label: 'آزادسازی سپرده قانونی', sign: 1, color: '#14b8a6' },
  pmt: { label: 'وصول اقساط', sign: 1, color: '#6366f1' },
  loan: { label: 'پرداخت تسهیلات (تعهد وام)', sign: -1, color: '#f43f5e' },
  withdrawal: { label: 'برداشت اصل سپرده', sign: -1, color: '#f59e0b' },
  profit: { label: 'سود پرداختی به سپرده‌گذاران', sign: -1, color: '#a855f7' },
};

function eventDetail(e: FlowEvent): string {
  const vin =
    e.vintageFrom === e.vintageTo ? `ویژه ماه ${toFa(e.vintageFrom)}` : `ویژه‌های ماه ${toFa(e.vintageFrom)} تا ${toFa(e.vintageTo)}`;
  if (e.type === 'pmt' && e.instFrom !== undefined && e.instTo !== undefined && e.instTotal !== undefined) {
    const inst =
      e.instFrom === e.instTo
        ? `قسط ${toFa(e.instFrom)} از ${toFa(e.instTotal)}`
        : `اقساط ${toFa(e.instFrom)} تا ${toFa(e.instTo)} از ${toFa(e.instTotal)}`;
    return `${inst} · ${vin}${e.vintages > 1 ? ` (${toFa(e.vintages)} ویژه)` : ''}`;
  }
  return vin;
}

function EventsDetail({
  row,
  prevCum,
  fmt,
  rr,
}: {
  row: MonthRow;
  prevCum: number;
  fmt: (v: number) => string;
  rr: number;
}) {
  const inflows = row.events.filter((e) => EVENT_META[e.type].sign > 0 || e.type === 'reserve');
  const outflows = row.events.filter((e) => e.type === 'loan' || e.type === 'withdrawal' || e.type === 'profit');
  const List = ({ items, empty }: { items: FlowEvent[]; empty: string }) => (
    <div className="space-y-1.5">
      {items.length === 0 && <div className="text-[11.5px] text-slate-400">{empty}</div>}
      {items.map((e, i) => {
        const m = EVENT_META[e.type];
        return (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100 dark:bg-slate-900/70 dark:ring-slate-800"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: tierColor(e.tierIndex) }} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                  {m.label}
                  {e.type === 'reserve' && ` ${fmtPct(rr)}`} — {e.tierName}
                </div>
                <div className="truncate text-[10.5px] text-slate-400">{eventDetail(e)}</div>
              </div>
            </div>
            <span
              dir="ltr"
              className={cn(
                'shrink-0 text-[12px] font-bold tabular-nums',
                m.sign > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}
            >
              {fmt(m.sign * e.amount)}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3 bg-slate-50/80 p-4 dark:bg-slate-950/40">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[12px] font-bold text-emerald-700 dark:text-emerald-400">منابع ورودی نقد (Inflows)</div>
          <List items={inflows} empty="ورودی نقدی در این ماه ثبت نشده است." />
        </div>
        <div>
          <div className="mb-2 text-[12px] font-bold text-rose-700 dark:text-rose-400">مصارف خروجی نقد (Outflows)</div>
          <List items={outflows} empty="خروجی نقدی در این ماه ثبت نشده است." />
        </div>
      </div>
      <div
        dir="ltr"
        className="overflow-x-auto rounded-lg bg-white px-3 py-2 text-left font-mono text-[11px] leading-6 text-slate-600 ring-1 ring-slate-100 dark:bg-slate-900/70 dark:text-slate-300 dark:ring-slate-800"
      >
        <div>
          NCF({toFa(row.t)}) = Inflows − Outflows = {fmt(row.inflow)} − {fmt(row.outflow)} ={' '}
          <b className={row.ncf < 0 ? 'text-rose-600' : 'text-emerald-600'}>{fmt(row.ncf)}</b>
        </div>
        <div>
          CumLiq({toFa(row.t)}) = CumLiq({row.t === 0 ? '−۱' : toFa(row.t - 1)}) + NCF = {fmt(prevCum)} + ({fmt(row.ncf)}) ={' '}
          <b className={row.cum < 0 ? 'text-rose-600' : 'text-emerald-600'}>{fmt(row.cum)}</b>
        </div>
      </div>
    </div>
  );
}

interface Props {
  result: SimResult;
  config: GlobalConfig;
  initialLiquidity: number;
  onExportCsv: () => void;
}

export function CashFlowTable({ result, config, initialLiquidity, onExportCsv }: Props) {
  const { factor, unit } = useDisplay();
  const H = config.horizon;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [scale, setScale] = useState<Scale>('full');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const k = result.kpis;
  const end = Math.min(H, to ?? H);

  const div = scale === 'full' ? 1 : scale === 'm' ? 1e6 : 1e9;
  const scaleLabel = scale === 'full' ? unit : scale === 'm' ? `میلیون ${unit}` : `میلیارد ${unit}`;
  const fmt = (v: number) => (scale === 'full' ? fmtNumber(Math.round(v * factor)) : fmtNumber((v * factor) / div, 2));
  const fmtLtr = (v: number) => {
    const s = fmt(v);
    return s.replace(/[\u2066-\u2069]/g, '');
  };

  const rows = useMemo(
    () =>
      result.rows.filter((r) => {
        if (r.t < from || r.t > end) return false;
        if (filter === 'deficit') return r.cum < -EPS;
        if (filter === 'negNcf') return r.ncf < -EPS;
        if (filter === 'events') return r.inflow > EPS || r.outflow > EPS;
        return true;
      }),
    [result.rows, from, end, filter],
  );

  const totals = rows.reduce(
    (a, r) => ({
      dep: a.dep + r.depositGross,
      rr: a.rr + r.reserveHeld,
      pmt: a.pmt + r.pmtInflow,
      rel: a.rel + r.reserveRelease,
      inflow: a.inflow + r.inflow,
      loan: a.loan + r.loanOut,
      wd: a.wd + r.withdrawalOut,
      profit: a.profit + r.profitPaid,
      outflow: a.outflow + r.outflow,
      ncf: a.ncf + r.ncf,
    }),
    { dep: 0, rr: 0, pmt: 0, rel: 0, inflow: 0, loan: 0, wd: 0, profit: 0, outflow: 0, ncf: 0 },
  );

  const toggle = (t: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const showRelease = config.releaseReserve;
  const showProfit = config.depositProfitRate > 0;
  const colCount = 12 + (showRelease ? 1 : 0) + (showProfit ? 1 : 0);
  const th =
    'sticky top-0 z-10 bg-slate-50 px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 whitespace-nowrap dark:bg-slate-900 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800';
  const td = 'px-3 py-2 whitespace-nowrap tabular-nums border-b border-slate-100 dark:border-slate-800/80';

  return (
    <Card>
      <CardHeader
        icon={<Table2 />}
        title="جدول ماهیانه گردش وجوه نقد (Cash-Flow Matrix)"
        subtitle="ریز جریان ورودی/خروجی هر ماه — روی هر سطر کلیک کنید تا تراکنش‌های تفکیکی به ازای هر پله و ویژه نمایش داده شود"
        actions={
          <Button size="sm" variant="secondary" onClick={onExportCsv}>
            <Download />
            خروجی CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 text-[12px] dark:border-slate-800">
        <span className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
          <ListFilter className="h-4 w-4 text-indigo-500" />
          بازه:
        </span>
        <div className="flex items-center gap-1.5 text-slate-500">
          از ماه
          <NumField size="sm" value={from} min={0} max={H} onChange={(v) => setFrom(Math.round(v))} className="w-[64px]" />
          تا ماه
          <NumField size="sm" value={end} min={0} max={H} onChange={(v) => setTo(Math.round(v))} className="w-[64px]" />
        </div>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'همه ماه‌ها' },
            { value: 'events', label: 'دارای تراکنش' },
            { value: 'negNcf', label: 'NCF منفی' },
            { value: 'deficit', label: 'کسری تجمعی' },
          ]}
        />
        <Segmented
          size="sm"
          value={scale}
          onChange={setScale}
          className="ms-auto"
          options={[
            { value: 'full', label: 'کامل' },
            { value: 'm', label: 'میلیون' },
            { value: 'b', label: 'میلیارد' },
          ]}
        />
        {(from !== 0 || to !== null || filter !== 'all') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFrom(0);
              setTo(null);
              setFilter('all');
            }}
          >
            حذف فیلتر
          </Button>
        )}
      </div>

      <div className="alm-scroll max-h-[620px] overflow-auto">
        <table className="w-full min-w-[1250px] border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className={cn(th, 'w-8')} />
              <th className={th}>ماه</th>
              <th className={th}>سپرده جدید</th>
              <th className={th}>سپرده قانونی</th>
              <th className={th}>اقساط وصولی</th>
              {showRelease && <th className={th}>آزادسازی RR</th>}
              <th className={cn(th, 'text-emerald-700 dark:text-emerald-400')}>جمع ورودی</th>
              <th className={th}>تعهد وام</th>
              <th className={th}>خروج سپرده</th>
              {showProfit && <th className={th}>سود سپرده</th>}
              <th className={cn(th, 'text-rose-700 dark:text-rose-400')}>جمع خروجی</th>
              <th className={th}>خالص جریان (NCF)</th>
              <th className={th}>نقدینگی تجمعی</th>
              <th className={th}>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-10 text-center text-slate-400">
                  ماهی با این فیلتر یافت نشد.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const open = expanded.has(r.t);
              const prevCum = r.t === 0 ? initialLiquidity : result.rows[r.t - 1].cum;
              const isTip = k.tippingPoint === r.t;
              const isMin = k.maxHole > 0 && k.minCumMonth === r.t;
              const isRec = k.recoveryMonth === r.t;
              return (
                <Fragment key={r.t}>
                  <tr
                    onClick={() => toggle(r.t)}
                    className={cn(
                      'cursor-pointer transition hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5',
                      r.cum < -EPS && 'bg-rose-50/60 dark:bg-rose-500/[0.06]',
                      open && 'bg-indigo-50/60 dark:bg-indigo-500/10',
                    )}
                  >
                    <td className={cn(td, 'text-slate-400')}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? 'بستن' : 'بازکردن'} جزئیات ماه ${toFa(r.t)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(r.t);
                        }}
                        className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180 text-indigo-500')} />
                      </button>
                    </td>
                    <td className={cn(td, 'font-bold text-slate-700 dark:text-slate-200')}>{toFa(r.t)}</td>
                    <td className={td}>{r.depositGross > EPS ? fmt(r.depositGross) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className={cn(td, 'text-slate-500')}>{r.reserveHeld > EPS ? fmt(-r.reserveHeld) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className={td}>{r.pmtInflow > EPS ? fmt(r.pmtInflow) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    {showRelease && (
                      <td className={td}>{r.reserveRelease > EPS ? fmt(r.reserveRelease) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    )}
                    <td className={cn(td, 'font-semibold text-emerald-700 dark:text-emerald-400')}>{fmt(r.inflow)}</td>
                    <td className={td}>{r.loanOut > EPS ? fmt(-r.loanOut) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className={td}>{r.withdrawalOut > EPS ? fmt(-r.withdrawalOut) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    {showProfit && (
                      <td className={cn(td, 'text-violet-600 dark:text-violet-400')}>
                        {r.profitPaid > EPS ? fmt(-r.profitPaid) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}
                    <td className={cn(td, 'font-semibold text-rose-700 dark:text-rose-400')}>{r.outflow > EPS ? fmt(-r.outflow) : fmt(0)}</td>
                    <td className={cn(td, 'font-bold', r.ncf < -EPS ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                      {fmt(r.ncf)}
                    </td>
                    <td className={cn(td, 'font-extrabold', r.cum < -EPS ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100')}>
                      {fmt(r.cum)}
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {isTip && <Badge tone="rose">واژگونی</Badge>}
                        {isMin && <Badge tone="rose">حداکثر کسری</Badge>}
                        {isRec && <Badge tone="emerald">بازیابی</Badge>}
                        {!isTip && !isMin && !isRec && (r.cum < -EPS ? <Badge tone="rose">کسری</Badge> : <Badge tone="emerald">مازاد</Badge>)}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={colCount} className="border-b border-slate-200 p-0 dark:border-slate-800">
                        <EventsDetail row={r} prevCum={prevCum} fmt={fmtLtr} rr={config.reserveRatio} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold">
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 dark:bg-slate-900" />
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 dark:bg-slate-900">جمع ({toFa(rows.length)} ماه)</td>
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums dark:bg-slate-900">{fmt(totals.dep)}</td>
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums text-slate-500 dark:bg-slate-900">{fmt(-totals.rr)}</td>
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums dark:bg-slate-900">{fmt(totals.pmt)}</td>
                {showRelease && <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums dark:bg-slate-900">{fmt(totals.rel)}</td>}
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums text-emerald-700 dark:bg-slate-900 dark:text-emerald-400">{fmt(totals.inflow)}</td>
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums dark:bg-slate-900">{fmt(-totals.loan)}</td>
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums dark:bg-slate-900">{fmt(-totals.wd)}</td>
                {showProfit && (
                  <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums text-violet-600 dark:bg-slate-900 dark:text-violet-400">
                    {fmt(-totals.profit)}
                  </td>
                )}
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums text-rose-700 dark:bg-slate-900 dark:text-rose-400">{fmt(-totals.outflow)}</td>
                <td className={cn('sticky bottom-0 bg-slate-100 px-3 py-2.5 tabular-nums dark:bg-slate-900', totals.ncf < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                  {fmt(totals.ncf)}
                </td>
                <td className="sticky bottom-0 bg-slate-100 px-3 py-2.5 dark:bg-slate-900" colSpan={2}>
                  <span className="text-[11px] font-medium text-slate-500">ارقام به {scaleLabel}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

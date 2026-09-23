import { useMemo, useState } from 'react';
import { FlaskConical, Grid3x3 } from 'lucide-react';
import type { SimInput, SimKpis } from '../types';
import { runSensitivity, SENS_VARS, type SensMetric, type SensVar } from '../lib/engine';
import { axisUnit, fmtNumber, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Segmented } from './ui';
import { cn } from '../utils/cn';

const METRICS: { value: SensMetric; label: string }[] = [
  { value: 'maxHole', label: 'حداکثر کسری' },
  { value: 'tipping', label: 'نقطه واژگونی' },
  { value: 'endCum', label: 'تراز پایان افق' },
  { value: 'leverage', label: 'اهرم خروج' },
];

function metricValue(k: SimKpis, m: SensMetric): number | null {
  switch (m) {
    case 'maxHole':
      return k.maxHole;
    case 'tipping':
      return k.tippingPoint;
    case 'endCum':
      return k.endCum;
    case 'leverage':
      return k.leverage;
  }
}

function Select({
  value,
  onChange,
  exclude,
}: {
  value: SensVar;
  onChange: (v: SensVar) => void;
  exclude: SensVar;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SensVar)}
      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      {SENS_VARS.filter((v) => v.key !== exclude).map((v) => (
        <option key={v.key} value={v.key}>
          {v.label} ({v.symbol})
        </option>
      ))}
    </select>
  );
}

export function SensitivityPanel({ input }: { input: SimInput }) {
  const { factor, unit } = useDisplay();
  const [xKey, setXKey] = useState<SensVar>('runoffRate');
  const [yKey, setYKey] = useState<SensVar>('takeUpRate');
  const [metric, setMetric] = useState<SensMetric>('maxHole');

  const grid = useMemo(() => runSensitivity(input, xKey, yKey), [input, xKey, yKey]);
  const xDef = SENS_VARS.find((v) => v.key === xKey)!;
  const yDef = SENS_VARS.find((v) => v.key === yKey)!;
  const H = input.config.horizon;

  const values = grid.cells.map((row) => row.map((k) => metricValue(k, metric)));
  const flat = values.flat().filter((v): v is number => v !== null);
  const maxAbs = Math.max(1e-9, ...flat.map((v) => Math.abs(v)));
  const maxPos = Math.max(1e-9, ...flat.filter((v) => v > 0));
  const maxNeg = Math.max(1e-9, ...flat.filter((v) => v < 0).map((v) => -v));
  const maxLev = Math.max(1.0001, ...flat);
  const moneyUnit = axisUnit(maxAbs * factor);

  const cellStyle = (v: number | null): { bg: string; fg: string } => {
    const red = (i: number) => ({ bg: `rgba(244,63,94,${0.1 + 0.8 * i})`, fg: i > 0.45 ? '#fff' : '' });
    const green = (i: number) => ({ bg: `rgba(16,185,129,${0.1 + 0.55 * i})`, fg: i > 0.6 ? '#fff' : '' });
    switch (metric) {
      case 'maxHole':
        return v === null || v <= 1e-6 ? green(0.5) : red(Math.min(1, v / maxAbs));
      case 'tipping':
        return v === null ? green(0.5) : red(Math.min(1, 1 - v / Math.max(1, H)));
      case 'endCum':
        return v === null ? green(0) : v < 0 ? red(Math.min(1, -v / maxNeg)) : green(Math.min(1, v / maxPos));
      case 'leverage':
        return v === null ? green(0) : v > 1 ? red(Math.min(1, (v - 1) / (maxLev - 1))) : green(Math.min(1, 1 - v));
    }
  };

  const cellText = (v: number | null) => {
    switch (metric) {
      case 'maxHole':
        return v === null || v <= 1e-6 ? '✓' : fmtNumber(-(v * factor) / moneyUnit.div, 1);
      case 'tipping':
        return v === null ? '✓' : `ماه ${toFa(v)}`;
      case 'endCum':
        return v === null ? '—' : fmtNumber((v * factor) / moneyUnit.div, 1);
      case 'leverage':
        return v === null ? '—' : `${fmtNumber(v, 2, true)}×`;
    }
  };

  const unitNote =
    metric === 'maxHole' || metric === 'endCum'
      ? `ارقام به ${moneyUnit.label} ${unit}`
      : metric === 'tipping'
        ? '✓ یعنی بدون واژگونی در افق'
        : 'نسبت خروجی به منابع خالص';

  return (
    <Card>
      <CardHeader
        icon={<FlaskConical />}
        title="آزمون حساسیت و بحران دوبعدی (Stress Matrix)"
        subtitle={`هر خانه یک شبیه‌سازی کامل ${toFa(H)} ماهه با ترکیب متفاوتی از دو متغیر ریسک است؛ خانه با قاب، سناریوی جاری را نشان می‌دهد`}
        actions={
          <Segmented size="sm" value={metric} onChange={setMetric} options={METRICS} />
        }
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 text-[12px] text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <span className="flex items-center gap-1.5 font-semibold">
          <Grid3x3 className="h-4 w-4 text-indigo-500" />
          محور افقی:
        </span>
        <Select value={xKey} onChange={setXKey} exclude={yKey} />
        <span className="font-semibold">محور عمودی:</span>
        <Select value={yKey} onChange={setYKey} exclude={xKey} />
        <Badge tone="slate" className="ms-auto">
          {unitNote}
        </Badge>
      </div>
      <div className="alm-scroll overflow-x-auto p-5">
        <table className="w-full min-w-[720px] border-separate border-spacing-1.5 text-[12px]">
          <thead>
            <tr>
              <th className="p-2 text-right text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <div className="leading-5">
                  <span className="text-indigo-600 dark:text-indigo-300">↓ {yDef.label}</span>
                  <br />
                  <span className="text-sky-600 dark:text-sky-300">← {xDef.label}</span>
                </div>
              </th>
              {grid.xs.map((x, xi) => (
                <th
                  key={xi}
                  className={cn(
                    'rounded-lg p-2 text-center text-[12px] font-bold',
                    xi === grid.xi
                      ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200'
                      : 'bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
                  )}
                >
                  {fmtRaw(x, 1)}٪
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.ys.map((y, yi) => (
              <tr key={yi}>
                <th
                  className={cn(
                    'rounded-lg p-2 text-center text-[12px] font-bold',
                    yi === grid.yi
                      ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200'
                      : 'bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
                  )}
                >
                  {fmtRaw(y, 1)}٪
                </th>
                {grid.xs.map((_, xi) => {
                  const v = values[yi][xi];
                  const st = cellStyle(v);
                  const current = xi === grid.xi && yi === grid.yi;
                  const k = grid.cells[yi][xi];
                  return (
                    <td
                      key={xi}
                      title={`واژگونی: ${k.tippingPoint === null ? 'ندارد' : 'ماه ' + toFa(k.tippingPoint)} | اهرم: ${fmtRaw(k.leverage, 2)}×`}
                      className={cn(
                        'h-12 rounded-lg text-center font-bold tabular-nums transition',
                        current && 'ring-[3px] ring-indigo-600 ring-offset-2 ring-offset-white dark:ring-indigo-400 dark:ring-offset-slate-900',
                        !st.fg && 'text-slate-800 dark:text-slate-100',
                      )}
                      style={{ background: st.bg, color: st.fg || undefined }}
                    >
                      {cellText(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-6 rounded" style={{ background: 'rgba(16,185,129,0.4)' }} />
            ایمن / مازاد
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-6 rounded" style={{ background: 'linear-gradient(to left, rgba(244,63,94,0.9), rgba(244,63,94,0.15))' }} />
            شدت ریسک نقدینگی
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-6 rounded ring-2 ring-indigo-600" />
            سناریوی جاری
          </span>
        </div>
      </div>
    </Card>
  );
}

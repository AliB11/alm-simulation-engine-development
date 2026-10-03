import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CircleSlash2,
  Dices,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Square,
  TrendingDown,
  TriangleAlert,
} from 'lucide-react';
import type { Behavior, DepositSchedule, GlobalConfig, SimInput } from '../types';
import {
  DEFAULT_MC,
  histogram,
  runMonteCarlo,
  STOCHASTIC_LABELS,
  type McOptions,
  type McSummary,
  type PercentileSet,
  type Perturbation,
  type StochasticKey,
} from '../lib/monteCarlo';
import { axisUnit, fmtCompact, fmtNumber, fmtPct, fmtRatio, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Button, Card, CardHeader, Field, Money, NumField, Segmented, SliderField } from './ui';
import { cn } from '../utils/cn';

interface Props {
  input: SimInput;
  onLoadRun: (
    patch: { behavior: Behavior; config: GlobalConfig; schedule: DepositSchedule },
    label: string,
  ) => void;
}

type McMetric = 'maxHole' | 'endCum' | 'netMargin' | 'leverage' | 'provision';

const METRICS: { value: McMetric; label: string; kind: 'money' | 'ratio' }[] = [
  { value: 'maxHole', label: 'حداکثر کسری', kind: 'money' },
  { value: 'endCum', label: 'تراز پایان افق', kind: 'money' },
  { value: 'netMargin', label: 'حاشیهٔ خالص', kind: 'money' },
  { value: 'leverage', label: 'اهرم خروج', kind: 'ratio' },
  { value: 'provision', label: 'هزینهٔ ذخیره', kind: 'money' },
];

const PERCENTILES: { key: keyof PercentileSet; label: string }[] = [
  { key: 'min', label: 'کمینه' },
  { key: 'p5', label: 'P5' },
  { key: 'p25', label: 'P25' },
  { key: 'p50', label: 'میانه' },
  { key: 'p75', label: 'P75' },
  { key: 'p95', label: 'P95' },
  { key: 'p99', label: 'P99' },
  { key: 'max', label: 'بیشینه' },
  { key: 'mean', label: 'میانگین' },
];

function probabilityTone(p: number): 'emerald' | 'amber' | 'rose' {
  if (p < 0.05) return 'emerald';
  if (p < 0.25) return 'amber';
  return 'rose';
}

function ProbTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  const tone = probabilityTone(value);
  const tones = {
    emerald: 'text-emerald-600 bg-emerald-50 ring-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/25',
    amber: 'text-amber-600 bg-amber-50 ring-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/25',
    rose: 'text-rose-600 bg-rose-50 ring-rose-200 dark:text-rose-300 dark:bg-rose-500/10 dark:ring-rose-500/25',
  } as const;
  return (
    <div className={cn('rounded-xl p-3.5 ring-1', tones[tone])}>
      <div className="flex items-center gap-2 text-[11.5px] font-bold">
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-[26px] font-black leading-9 tabular-nums">{fmtPct(value * 100, 1)}</div>
      <div className="text-[10.5px] leading-4 opacity-80">{hint}</div>
    </div>
  );
}

interface Bin {
  label: string;
  from: number;
  to: number;
  count: number;
}

function HistTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Bin }>;
  kind: 'money' | 'ratio';
}) {
  const d = payload?.[0]?.payload;
  const { unit } = useDisplay();
  if (!active || !d) return null;
  return (
    <div
      dir="rtl"
      className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11.5px] text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="font-extrabold">
        بازهٔ {kind === 'ratio' ? `${fmtRaw(d.from, 2)} تا ${fmtRaw(d.to, 2)}` : `${fmtCompact(d.from)} تا ${fmtCompact(d.to)}`}
      </div>
      <div className="mt-0.5">
        تعداد اجرا: <b>{toFa(d.count)}</b>
      </div>
      {kind === 'money' && <div className="text-[10px] text-slate-400">ارقام به {unit}</div>}
    </div>
  );
}

/** آنچه یک اجرا بر مبنای آن انجام شده — برای سنجش کهنه بودن نتیجه */
interface RunSnapshot {
  summary: McSummary;
  input: SimInput;
  opts: McOptions;
}

export function MonteCarloPanel({ input, onLoadRun }: Props) {
  const { dark, factor, unit } = useDisplay();
  const [opts, setOpts] = useState<McOptions>(DEFAULT_MC);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [metric, setMetric] = useState<McMetric>('maxHole');
  const cancelRef = useRef(false);

  /* پرچم «ورودی تغییر کرد» در رندر از روی هویت ورودی‌های همان اجرا derive
     می‌شود؛ نیازی به effect و setState آبشاری نیست. */
  const stale = run !== null && (run.input !== input || run.opts !== opts);
  const summary = run?.summary ?? null;

  const patch = useCallback((p: Partial<McOptions>) => {
    setOpts((o) => ({ ...o, ...p }));
  }, []);

  const toggleKey = useCallback((key: StochasticKey) => {
    setOpts((o) => ({ ...o, stochastic: { ...o.stochastic, [key]: !o.stochastic[key] } }));
  }, []);

  const execute = useCallback(async () => {
    cancelRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: Math.round(opts.runs) });
    await new Promise((r) => setTimeout(r, 24));
    const res = await runMonteCarlo(input, opts, setProgress, () => cancelRef.current);
    setRun({ summary: res, input, opts });
    setRunning(false);
    setProgress(null);
  }, [input, opts]);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const metricDef = METRICS.find((m) => m.value === metric) ?? METRICS[0];
  const displayValues = useMemo(() => {
    if (!summary) return [] as number[];
    const scale = metricDef.kind === 'money' ? factor : 1;
    return summary.samples.map((s) => (metric === 'leverage' ? Math.min(s.leverage, 1e6) : s[metric]) * scale);
  }, [summary, metric, metricDef.kind, factor]);
  const histUnit = axisUnit(Math.max(1, ...displayValues.map((v) => Math.abs(v))));
  const bins = useMemo<Bin[]>(
    () =>
      histogram(displayValues, 16).map((b) => ({
        ...b,
        label: metricDef.kind === 'ratio' ? fmtRaw(b.from, 1) : fmtRaw(b.from / histUnit.div, 1),
      })),
    [displayValues, histUnit.div, metricDef.kind],
  );
  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 };

  const rows = summary
    ? METRICS.map((m) => ({
        def: m,
        stats:
          m.value === 'maxHole'
            ? summary.maxHole
            : m.value === 'endCum'
              ? summary.endCum
              : m.value === 'netMargin'
                ? summary.netMargin
                : m.value === 'provision'
                  ? summary.provision
                  : summary.leverage,
      }))
    : [];

  const fmtCell = (kind: 'money' | 'ratio', v: number) =>
    kind === 'ratio' ? fmtRatio(v) : <Money compact value={v} />;

  const perturbDiffs = useCallback(
    (p: Perturbation) => {
      const items: { label: string; base: string; perturbed: string }[] = [
        {
          label: STOCHASTIC_LABELS.takeUpRate.label,
          base: fmtPct(input.behavior.takeUpRate, 1),
          perturbed: fmtPct(p.takeUpRate, 1),
        },
        {
          label: STOCHASTIC_LABELS.approvalRate.label,
          base: fmtPct(input.behavior.approvalRate, 1),
          perturbed: fmtPct(p.approvalRate, 1),
        },
        {
          label: STOCHASTIC_LABELS.runoffRate.label,
          base: fmtPct(input.behavior.runoffRate, 1),
          perturbed: fmtPct(p.runoffRate, 1),
        },
        {
          label: STOCHASTIC_LABELS.churnRate.label,
          base: fmtPct(input.behavior.churnRate, 1),
          perturbed: fmtPct(p.churnRate, 1),
        },
        {
          label: STOCHASTIC_LABELS.totalDeposit.label,
          base: fmtCompact(input.behavior.totalDeposit * factor),
          perturbed: fmtCompact(p.totalDeposit * factor),
        },
        {
          label: STOCHASTIC_LABELS.defaultRate.label,
          base: fmtPct(input.config.defaultRate, 1),
          perturbed: fmtPct(p.defaultRate, 1),
        },
      ];
      if (p.timingShift !== 0) {
        items.push({
          label: STOCHASTIC_LABELS.timing.label,
          base: '—',
          perturbed: `${p.timingShift > 0 ? '+' : '−'}${fmtNumber(Math.abs(p.timingShift))} ماه`,
        });
      }
      return items.filter((it) => it.base !== it.perturbed);
    },
    [input, factor],
  );

  return (
    <Card>
      <CardHeader
        icon={<Dices />}
        title="آزمون مونت‌کارلو و سنجش ریسک (VaR)"
        subtitle={`توزیع پیامدها به‌جای یک عدد قطعی — ${toFa(Math.round(opts.runs))} شبیه‌سازی کامل با اختلال تصادفی در ورودی‌های رفتاری`}
        actions={
          <>
            {stale && summary && (
              <Badge tone="amber">
                <CircleSlash2 />
                ورودی تغییر کرد
              </Badge>
            )}
            {running ? (
              <Button size="sm" variant="danger" onClick={stop}>
                <Square />
                توقف
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={execute} disabled={!input.tiers.length}>
                <Play />
                اجرای آزمون
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Field label="تعداد اجرا" info="هر اجرا یک شبیه‌سازی کامل موتور است. ۲۰۰ اجرا برای بیشتر طرح‌ها کمتر از چند ثانیه طول می‌کشد.">
              <NumField value={opts.runs} onChange={(v) => patch({ runs: Math.round(v) })} min={10} max={2000} step={50} size="sm" />
            </Field>
            <Field label="دانهٔ تصادفی (Seed)" info="با دانهٔ یکسان، دنبالهٔ اعداد تصادفی و در نتیجه همهٔ نتایج دقیقاً بازتولید می‌شود.">
              <NumField value={opts.seed} onChange={(v) => patch({ seed: Math.round(v) })} min={0} max={99999999} step={1} size="sm" />
            </Field>
          </div>

          <SliderField
            label="شدت عدم قطعیت"
            symbol="σ"
            value={opts.intensity}
            onChange={(v) => patch({ intensity: v })}
            min={0}
            max={100}
            step={5}
            color="#8b5cf6"
            icon={<Gauge />}
            hint={`در شدت ۱۰۰٪، انحراف معیار نرخ‌ها ۲۰ واحد درصد و انحراف معیار لگاریتمی حجم منابع ۲۵٪ است. شدت ${fmtPct(opts.intensity, 0)} ⇒ σ ≈ ${fmtNumber((opts.intensity / 100) * 20, 1)} واحد درصد`}
          />

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="mb-2 text-[12px] font-extrabold text-slate-700 dark:text-slate-200">
              متغیرهای تصادفی
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STOCHASTIC_LABELS) as StochasticKey[]).map((k) => {
                const on = opts.stochastic[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKey(k)}
                    title={`${STOCHASTIC_LABELS[k].symbol} — ${on ? 'تصادفی' : 'قطعی (ثابت)'}`}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ring-1 transition',
                      on
                        ? 'bg-indigo-600 text-white ring-indigo-600 dark:bg-indigo-500 dark:ring-indigo-500'
                        : 'bg-white text-slate-400 ring-slate-200 hover:text-slate-600 dark:bg-slate-900 dark:ring-slate-700 dark:hover:text-slate-300',
                    )}
                  >
                    <span dir="ltr" className="font-mono text-[10px] opacity-80">
                      {STOCHASTIC_LABELS[k].symbol}
                    </span>
                    {STOCHASTIC_LABELS[k].label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpts(DEFAULT_MC)}
              >
                <RotateCcw />
                بازنشانی تنظیمات آزمون
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {progress && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="mb-2 flex items-center justify-between text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                  در حال اجرای شبیه‌سازی‌ها…
                </span>
                <span className="tabular-nums">
                  {toFa(progress.done)} / {toFa(progress.total)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {!summary && !progress && (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center dark:border-slate-700 dark:bg-slate-950/40">
              <TriangleAlert className="h-7 w-7 text-violet-400" />
              <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300">آزمون هنوز اجرا نشده است</div>
              <p className="max-w-lg text-[11.5px] leading-6 text-slate-500 dark:text-slate-400">
                در هر اجرا، نرخ‌های تقاضا، قبولی، خروج سپرده، انصراف و نکول با توزیع نرمال حول برآورد شما و حجم منابع با
                توزیع لگ‌نرمال نمونه‌گیری می‌شوند؛ زمان‌بندی ورود منابع نیز می‌تواند یک شوک تأخیر/تعجیل سیستمی بگیرد.
                خروجی، احتمال واژگونی و صدک‌های ریسک است.
              </p>
            </div>
          )}

          {/* توقف پیش از کامل‌شدن نخستین اجرا نباید «۰٪ ریسک» را نشان دهد؛
              نبود داده با صفر بودن احتمال یکی نیست. */}
          {summary && summary.runs === 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-[12px] leading-6 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
              <CircleSlash2 className="mt-1 h-4 w-4 shrink-0" />
              <div>
                آزمون پیش از تکمیل حتی یک اجرا متوقف شد، پس آماری برای نمایش وجود ندارد. برای دیدن توزیع ریسک، آزمون را دوباره
                اجرا کنید و اجازه دهید دست‌کم چند اجرا کامل شود.
              </div>
            </div>
          )}

          {summary && summary.runs > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <ProbTile
                  icon={<AlertTriangle />}
                  label="احتمال واژگونی نقدینگی"
                  value={summary.pTipping}
                  hint="سهم اجراهایی که نقدینگی تجمعی‌شان در افق منفی شده است"
                />
                <ProbTile
                  icon={<TrendingDown />}
                  label="احتمال زیان محصول"
                  value={summary.pLoss}
                  hint="سهم اجراهایی با حاشیهٔ خالص منفی پس از سود سپرده و تأمین کسری"
                />
                <ProbTile
                  icon={<CircleSlash2 />}
                  label="احتمال هرگونه کسری"
                  value={summary.pDeficit}
                  hint="سهم اجراهایی که دست‌کم یک ماه کسری تجمعی داشته‌اند"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] font-extrabold text-slate-700 dark:text-slate-200">توزیع صدکی پیامدها</div>
                <Segmented
                  size="sm"
                  value={metric}
                  onChange={setMetric}
                  options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
                />
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
                <table className="w-full min-w-[720px] border-collapse text-right text-[11.5px]">
                  <caption className="sr-only">توزیع صدکی پیامدهای مونت‌کارلو</caption>
                  <thead>
                    <tr className="bg-slate-50 font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">سنجه</th>
                      {PERCENTILES.map((p) => (
                        <th key={p.key} className="border-b border-slate-200 px-2 py-2 tabular-nums dark:border-slate-800">
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ def, stats }) => (
                      <tr key={def.value} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                        <td className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">{def.label}</td>
                        {PERCENTILES.map((p) => (
                          <td
                            key={p.key}
                            className={cn(
                              'px-2 py-2 tabular-nums',
                              p.key === 'p95' || p.key === 'p99'
                                ? 'font-bold text-rose-600 dark:text-rose-400'
                                : 'text-slate-600 dark:text-slate-300',
                            )}
                          >
                            {fmtCell(def.kind, stats[p.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10.5px] text-slate-400">
                ارقام پولی به {unit} · ستون‌های P95 و P99 دنبالۀ بالای توزیع ریسک‌اند (بدترین حالت‌ها)
              </div>

              {summary.leverageInfRuns > 0 && (
                <div className="text-[10.5px] text-slate-400">
                  {toFa(summary.leverageInfRuns)} اجرا اهرم نامتناهی داشتند (منابع خالص صفر) و از صدک‌های اهرم کنار
                  گذاشته شدند؛ در هیستوگرام اهرم، این اجراها در ستون ۱٬۰۰۰٬۰۰۰× تجمیع شده‌اند.
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-400">
                <span>هیستوگرام توزیع {metricDef.label} در {toFa(summary.runs)} اجرا</span>
                <span>محور افقی: {metricDef.kind === 'ratio' ? 'مقدار اهرم' : histUnit.label || 'مقدار'} · محور عمودی: تعداد اجرا</span>
              </div>
              <div dir="ltr" className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bins} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                    <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={{ stroke: grid }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis
                      tickFormatter={(v: number) => fmtRaw(v)}
                      tick={tick}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<HistTooltip kind={metricDef.kind} />}
                      cursor={{ fill: dark ? 'rgba(148,163,184,0.08)' : 'rgba(99,102,241,0.06)' }}
                    />
                    <Bar dataKey="count" isAnimationActive={false} maxBarSize={44} radius={[4, 4, 0, 0]}>
                      {bins.map((b, i) => (
                        <Cell key={i} fill={b.from < 0 ? '#f43f5e' : '#6366f1'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {summary.worst && (
                <div className="grid gap-3 lg:grid-cols-2">
                  {([
                    { title: 'بدترین اجرا (بیشترین کسری)', run: summary.worst, tone: 'rose' as const },
                    { title: 'بهترین اجرا (کمترین کسری)', run: summary.best!, tone: 'emerald' as const },
                  ]).map(({ title, run, tone }) => (
                    <div
                      key={title}
                      className={cn(
                        'rounded-xl p-3.5 ring-1',
                        tone === 'rose'
                          ? 'bg-rose-50 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/25'
                          : 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/25',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-extrabold text-slate-700 dark:text-slate-200">{title}</div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            onLoadRun(
                              { behavior: run.behavior, config: run.config, schedule: run.schedule },
                              title,
                            )
                          }
                        >
                          <RotateCcw />
                          بارگذاری در برنامه
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
                        <span className="text-slate-500 dark:text-slate-400">حداکثر کسری</span>
                        <span className="font-bold tabular-nums">
                          <Money compact value={run.kpis.maxHole} />
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">نقطهٔ واژگونی</span>
                        <span className="font-bold">
                          {run.kpis.tippingPoint === null ? 'بدون واژگونی' : `ماه ${toFa(run.kpis.tippingPoint)}`}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">حاشیهٔ خالص</span>
                        <span className="font-bold tabular-nums">
                          <Money compact value={run.kpis.netMargin} />
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">اهرم خروج</span>
                        <span className="font-bold tabular-nums">{fmtRatio(run.kpis.leverage)}</span>
                      </div>
                      {(() => {
                        const diffs = perturbDiffs(run.perturbation);
                        if (!diffs.length) return null;
                        return (
                          <div className="mt-2.5 space-y-1 border-t border-slate-200/70 pt-2 dark:border-slate-700/60">
                            <div className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400">
                              انحراف از برآورد پایه
                            </div>
                            {diffs.map((d) => (
                              <div key={d.label} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500 dark:text-slate-400">{d.label}</span>
                                <span className="tabular-nums font-semibold">
                                  {d.base} ← {d.perturbed}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}

              <div className="text-[10.5px] leading-5 text-slate-400">
                {toFa(summary.runs)} اجرا در {fmtNumber(summary.elapsedMs, 0)} میلی‌ثانیه · دانهٔ {toFa(summary.seed)} ·
                شدت {fmtPct(summary.intensity, 0)} — نتایج با همین دانه دقیقاً بازتولیدپذیرند
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

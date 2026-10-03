import { useCallback, useState } from 'react';
import {
  BadgeCheck,
  CircleSlash2,
  Loader2,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
} from 'lucide-react';
import type { SimInput, Tier } from '../types';
import {
  DEFAULT_CONSTRAINTS,
  describeLevers,
  designTiers,
  leverKey,
  NEUTRAL_LEVERS,
  OBJECTIVE_LABELS,
  optimizeDesign,
  type CandidateDesign,
  type Constraints,
  type DesignLevers,
  type Objective,
  type OptimizationResult,
} from '../lib/optimizer';
import { fmtNumber, fmtPct, fmtRatio, toFa } from '../lib/format';
import { Badge, Button, Card, CardHeader, Field, NumField, Segmented, Toggle } from './ui';
import { cn } from '../utils/cn';

interface Props {
  input: SimInput;
  onApply: (tiers: Tier[], label: string) => void;
}

function Metric({
  label,
  base,
  best,
  format,
  lowerIsBetter,
  nullIsBest,
}: {
  label: string;
  base: number | null;
  best: number | null;
  format: (v: number | null) => string;
  lowerIsBetter?: boolean;
  /** برای سنجه‌هایی که «نداشتن» بهترین حالت است (مثل نقطهٔ واژگونی): رفع کامل هم بهبود شمرده می‌شود */
  nullIsBest?: boolean;
}) {
  const improved =
    nullIsBest && base !== null && best === null
      ? true
      : base !== null && best !== null && Number.isFinite(base) && Number.isFinite(best)
        ? lowerIsBetter
          ? best < base - 1e-9
          : best > base + 1e-9
        : false;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-black text-slate-800 dark:text-slate-100">{format(best)}</span>
        <span className="text-[11px] text-slate-400">پایه: {format(base)}</span>
      </div>
      <div className={cn('mt-1 text-[10.5px] font-semibold', improved ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')}>
        {improved ? 'بهبود نسبت به طرح جاری' : 'بدون تغییر نسبت به طرح جاری'}
      </div>
    </div>
  );
}

function LeverChips({ cand }: { cand: CandidateDesign }) {
  const parts = describeLevers(cand.levers);
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map((p) => (
        <span
          key={p}
          className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {p}
        </span>
      ))}
    </div>
  );
}

/** عنوان کارت نتیجه — «بهینه» فقط وقتی که واقعاً طرح موجهی پیدا شده باشد */
export function resultHeadline(result: OptimizationResult): string {
  if (!result.anyFeasible) return 'کم‌نقض‌ترین طرح یافت‌شده';
  return result.improved ? 'طرح بهینهٔ پیشنهادی' : 'طرح جاری همان بهینه است';
}

/**
 * جعبهٔ خلاصهٔ طرح پیشنهادی.
 *
 * جدا از پنل بیرون کشیده شده تا مستقل از حالت داخلی پنل (که با کلیک پر
 * می‌شود) قابل رندر و آزمون باشد.
 */
export function OptimizerSummary({
  result,
  stale,
  onApplyLevers,
}: {
  result: OptimizationResult;
  stale: boolean;
  onApplyLevers: (levers: DesignLevers, label: string) => void;
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3.5 ring-1',
        result.best.feasible
          ? 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/25'
          : 'bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/25',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-extrabold text-slate-700 dark:text-slate-200">{resultHeadline(result)}</div>
          <div className="mt-1.5">
            <LeverChips cand={result.best} />
          </div>
          <div className="mt-1.5 text-[10.5px] leading-5 text-slate-500 dark:text-slate-400">
            {toFa(result.evaluations)} طراحی متمایز از {toFa(result.probes)} ترکیب اهرم، از {toFa(result.starts)} نقطهٔ شروع در
            حداکثر {toFa(result.passes)} گذر · {fmtNumber(result.elapsedMs, 0)} میلی‌ثانیه
            {result.anyFeasible ? '' : ' · هیچ طراحی همهٔ قیدها را برآورده نکرد؛ رتبه‌بندی بر پایهٔ کمترین شدت نقض است'}
          </div>
        </div>
        <Button
          size="sm"
          variant={result.best.feasible ? 'primary' : 'secondary'}
          disabled={!result.improved || stale}
          title={stale ? 'ورودی عوض شده؛ ابتدا بهینه‌سازی را دوباره اجرا کنید' : 'جایگزینی پله‌ها با طرح بهینه'}
          onClick={() => onApplyLevers(result.best.levers, 'طرح بهینه')}
        >
          <Sparkles />
          اعمال طرح بهینه
        </Button>
      </div>
      {!result.best.feasible && (
        <div className="mt-2 space-y-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <div>نقض قیدها: {result.best.violations.join(' · ')}</div>
          <div className="font-medium text-amber-600/90 dark:text-amber-400/80">
            طرح جاری {result.baseline.violations.length
              ? `هم این قیدها را نقض می‌کند (${result.baseline.violations.join(' · ')})`
              : 'موجه است'}{' '}
            — برای رسیدن به طرح موجه، قیدها را شل کنید یا سقف‌های نقدینگی و اهرم را بازبینی کنید.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * جدول نامزدهای برتر. هر ردیف یک «طراحی متمایز» است — ترکیب‌های اهرمی که پس
 * از مهار در کران‌های قانونی و گزینه‌های معتبر به پله‌های یکسان می‌رسند، در بهینه‌یاب ادغام
 * شده‌اند و اینجا تکراری ظاهر نمی‌شوند.
 */
export function OptimizerResultTable({
  result,
  objective,
  stale,
  onApplyLevers,
}: {
  result: OptimizationResult;
  objective: Objective;
  stale: boolean;
  onApplyLevers: (levers: DesignLevers, label: string) => void;
}) {
  return (
    <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
      <table className="w-full min-w-[900px] border-collapse text-right">
        <caption className="sr-only">نامزدهای طرح پیشنهادی و شدت نقض قیدها</caption>
        <thead>
          <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">رتبه</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">اهرم‌های طراحی</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">مقدار هدف</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">حفره / منابع</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">حاشیهٔ خالص</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">اهرم</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">شدت نقض</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">وضعیت</th>
            <th className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">عمل</th>
          </tr>
        </thead>
        <tbody className="text-[12px]">
          {result.candidates.map((c, i) => {
            const holePct = c.kpis.netDeposit > 0 ? (c.kpis.maxHole / c.kpis.netDeposit) * 100 : 0;
            const isBest = c.fingerprint === result.best.fingerprint;
            return (
              <tr
                key={c.fingerprint}
                className={cn(
                  'border-b border-slate-100 dark:border-slate-800/70',
                  isBest && 'bg-indigo-50/60 dark:bg-indigo-500/5',
                )}
              >
                <td className="px-3 py-2 font-black text-slate-500 dark:text-slate-400">{toFa(i + 1)}</td>
                <td className="px-3 py-2">
                  <LeverChips cand={c} />
                </td>
                <td className="px-3 py-2 font-bold tabular-nums">
                  {objective === 'safety' ? fmtNumber(Math.round(-c.objective)) : fmtNumber(Math.round(c.objective))}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtPct(holePct, 1)}</td>
                <td className="px-3 py-2 tabular-nums">
                  <span className={c.kpis.netMargin < 0 ? 'text-rose-600 dark:text-rose-400' : undefined}>
                    {fmtNumber(Math.round(c.kpis.netMargin))}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{fmtRatio(c.kpis.leverage)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                  {c.feasible ? '—' : fmtNumber(c.severity, 2, true)}
                </td>
                <td className="px-3 py-2">
                  {c.feasible ? (
                    <Badge tone="emerald">موجه</Badge>
                  ) : (
                    <span title={c.violations.join(' · ')}>
                      <Badge tone="rose">{toFa(c.violations.length)} نقض</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={stale || c.key === leverKey(NEUTRAL_LEVERS)}
                    title={
                      stale
                        ? 'ورودی عوض شده؛ ابتدا بهینه‌سازی را دوباره اجرا کنید'
                        : c.key === leverKey(NEUTRAL_LEVERS)
                          ? 'این ردیف همان طرح جاری است'
                          : 'جایگزینی پله‌ها با این طراحی'
                    }
                    onClick={() => onApplyLevers(c.levers, `طرح رتبهٔ ${i + 1}`)}
                  >
                    اعمال
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** آنچه یک اجرا بر مبنای آن انجام شده — برای سنجش کهنه بودن نتیجه */
interface RunSnapshot {
  result: OptimizationResult;
  input: SimInput;
  objective: Objective;
  constraints: Constraints;
}

/**
 * بهینه‌یاب طراحی پله‌ها («طراح معکوس»):
 * کاربر هدف و قیدها را مشخص می‌کند و موتور با جست‌وجوی مختصاتی چندشروعی روی
 * سه اهرم مجاز طراحی، بهترین ترکیب را یافته و طرح‌های برتر را رتبه‌بندی می‌کند.
 */
export function OptimizerPanel({ input, onApply }: Props) {
  const [objective, setObjective] = useState<Objective>('safety');
  const [constraints, setConstraints] = useState<Constraints>(DEFAULT_CONSTRAINTS);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [running, setRunning] = useState(false);

  /* نتیجه فقط نسبت به ورودی‌های لحظهٔ اجرا معتبر است. به‌جای یک effect که
     پرچم «کهنه» را ست کند، همان پرچم در رندر از روی هویت ورودی‌های ذخیره‌شده
    derive می‌شود — بدون رندر آبشاری و بدون حالت اضافی که بتواند واگرا شود. */
  const stale =
    run !== null && (run.input !== input || run.objective !== objective || run.constraints !== constraints);
  const result = run?.result ?? null;

  const patch = useCallback((p: Partial<Constraints>) => {
    setConstraints((c) => ({ ...c, ...p }));
  }, []);

  const execute = useCallback(async () => {
    setRunning(true);
    // یک نوبت رویداد تا نشانگر بارگذاری پیش از محاسبه رنگ شود
    await new Promise((r) => setTimeout(r, 24));
    const res = optimizeDesign(input, { objective, constraints, passes: 3, topN: 6 });
    setRun({ result: res, input, objective, constraints });
    setRunning(false);
  }, [input, objective, constraints]);

  /* تنها مسیر اعمال سه اهرم مجاز؛ نرخ‌ها و سهم‌های تخصیص بدون تغییر می‌مانند. */
  const applyLeversOf = useCallback(
    (levers: DesignLevers, label: string) => onApply(designTiers(input, levers), label),
    [input, onApply],
  );

  const base = result?.baseline.kpis ?? null;
  const best = result?.best.kpis ?? null;

  return (
    <Card>
      <CardHeader
        icon={<SlidersHorizontal />}
        title="بهینه‌یاب طراحی پله‌ها (طراح معکوس)"
        subtitle="هدف و قیدها را تعیین کنید؛ موتور با جست‌وجوی مختصاتی روی اهرم‌های طراحی، بهترین ترکیب پله‌ها را می‌یابد"
        actions={
          <>
            {stale && result && (
              <Badge tone="amber">
                <CircleSlash2 />
                ورودی تغییر کرد — اجرا مجدد
              </Badge>
            )}
            <Button size="sm" variant="primary" onClick={execute} disabled={running || !input.tiers.length}>
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? 'در حال جست‌وجو…' : 'اجرای بهینه‌سازی'}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Field label="هدف بهینه‌سازی" info="معیاری که موتور آن را بیشینه (یا در حالت ایمنی، کمینه) می‌کند.">
            <Segmented
              full
              value={objective}
              onChange={setObjective}
              options={(Object.keys(OBJECTIVE_LABELS) as Objective[]).map((k) => ({
                value: k,
                label: OBJECTIVE_LABELS[k].label,
                icon: k === 'safety' ? <ShieldCheck /> : <Target />,
              }))}
            />
            <div className="mt-1.5 text-[11px] leading-5 text-slate-400">{OBJECTIVE_LABELS[objective].hint}</div>
          </Field>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="mb-3 flex items-center gap-2 text-[12.5px] font-extrabold text-slate-700 dark:text-slate-200">
              <BadgeCheck className="h-4 w-4 text-indigo-500" />
              قیدهای طراحی
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="سقف حفرهٔ نقدینگی" info="حداکثر کسری تجمعی مجاز، به درصد منابع ورودی خالص. صفر یعنی بدون محدودیت.">
                  <NumField
                    value={constraints.maxHolePct}
                    onChange={(v) => patch({ maxHolePct: v })}
                    min={0}
                    max={200}
                    step={1}
                    decimals={1}
                    suffix="٪"
                    size="sm"
                  />
                </Field>
                <Field label="سقف اهرم خروج" info="نسبت کل خروجی‌ها به منابع ورودی خالص. صفر یعنی بدون محدودیت.">
                  <NumField
                    value={constraints.maxLeverage}
                    onChange={(v) => patch({ maxLeverage: v })}
                    min={0}
                    max={100}
                    step={0.1}
                    decimals={2}
                    suffix="×"
                    size="sm"
                  />
                </Field>
              </div>
              <Toggle
                checked={constraints.requirePositiveMargin}
                onChange={(v) => patch({ requirePositiveMargin: v })}
                label="حاشیهٔ خالص دست‌کم صفر باشد"
                description="طرح‌های زیان‌ده از فهرست موجه‌ها کنار گذاشته می‌شوند"
              />
              <Toggle
                checked={constraints.requireSolvent}
                onChange={(v) => patch({ requireSolvent: v })}
                label="واژگونی نقدینگی در افق مجاز نباشد"
                description="سخت‌گیرانه‌ترین قید: نقدینگی تجمعی هیچ ماهی منفی نشود"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {!result && (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center dark:border-slate-700 dark:bg-slate-950/40">
              <Sparkles className="h-7 w-7 text-indigo-400" />
              <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300">هنوز بهینه‌سازی اجرا نشده است</div>
              <p className="max-w-sm text-[11.5px] leading-6 text-slate-500 dark:text-slate-400">
                اهرم‌های جست‌وجو: مقیاس منطقی ضرایب برابری (α)، جابه‌جایی دورهٔ انتظار (T_dep) و جابه‌جایی دورهٔ بازپرداخت
                (T_loan). نرخ اختصاصی، سهم تخصیص و حداقل ماندهٔ همهٔ حالت‌ها دقیقاً ثابت می‌ماند و دورهٔ بازپرداخت فقط از
                گزینه‌های معتبر همان طرح انتخاب می‌شود.
              </p>
            </div>
          )}

          {result && base && best && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label="حداکثر کسری نقدینگی"
                  base={base.maxHole}
                  best={best.maxHole}
                  lowerIsBetter
                  format={(v) => (v === null ? '—' : fmtNumber(Math.round(v)))}
                />
                <Metric
                  label="حاشیهٔ خالص بانک"
                  base={base.netMargin}
                  best={best.netMargin}
                  format={(v) => (v === null ? '—' : fmtNumber(Math.round(v)))}
                />
                <Metric
                  label="کل تعهد اعطای وام"
                  base={base.totalCommitment}
                  best={best.totalCommitment}
                  format={(v) => (v === null ? '—' : fmtNumber(Math.round(v)))}
                />
                <Metric
                  label="نقطهٔ واژگونی"
                  base={base.tippingPoint}
                  best={best.tippingPoint}
                  lowerIsBetter
                  nullIsBest
                  format={(v) => (v === null ? 'بدون واژگونی' : `ماه ${toFa(v)}`)}
                />
              </div>

              <OptimizerSummary result={result} stale={stale} onApplyLevers={applyLeversOf} />
            </>
          )}
        </div>
      </div>

      {result && <OptimizerResultTable result={result} objective={objective} stale={stale} onApplyLevers={applyLeversOf} />}

      <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        روش حل: <b>جست‌وجوی نزولی مختصاتی چندشروعی</b> روی شبکهٔ گسستهٔ سه اهرم با حداکثر سه گذر از هر نقطهٔ شروع (طرح جاری
        + کران‌های هر اهرم) تا احتمال گیرافتادن در بهینهٔ محلی کمتر شود. ترتیب اولویت: <b>۱)</b> موجه بودن (رعایت همهٔ
        قیدها) اولویت مطلق دارد؛ <b>۲)</b> اگر هیچ طرحی موجه نبود، کمترین «شدت نقض» — نه بزرگ‌ترین عدد هدف — ملاک است تا
        موتور طرحی را پیشنهاد ندهد که فقط سود را بالا می‌برد و کسری نقدینگی را چند برابر می‌کند؛ <b>۳)</b> سپس مقدار هدف
        بیشینه می‌شود و <b>۴)</b> در تساوی، طراحی نزدیک‌تر به طرح جاری انتخاب می‌شود. ترکیب‌های اهرمی که پس از مهار در
        کران‌های قانونی و گزینه‌های معتبر به پله‌های یکسان می‌رسند، یک نامزد بیشتر اشغال نمی‌کنند. «اعمال» فقط پله‌ها را جایگزین می‌کند؛
        پیکربندی کلان و رفتار دست‌نخورده می‌ماند.
      </div>
    </Card>
  );
}

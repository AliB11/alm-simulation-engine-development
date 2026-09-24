import { CalendarClock, Plus, Trash, TrendingDown, UserCheck, Users, Wallet, LogOut } from 'lucide-react';
import type { Behavior, CustomVintage, DepositSchedule, GlobalConfig, SimResult, Vintage } from '../types';
import { fmtCompact, fmtPct, toFa } from '../lib/format';
import { uid } from '../lib/presets';
import { commitmentFactor, uniformVintageCount, withdrawalFactor } from '../lib/engine';
import { useDisplay } from '../context/display';
import { Badge, Button, Card, CardHeader, Field, Money, NumField, Segmented, SliderField } from './ui';
import { KpiBoard, TierCommitmentTable } from './KpiBoard';

const QUICK_AMOUNTS = [10e9, 50e9, 100e9, 500e9, 1e12];

function VintageStrip({ vintages, horizon }: { vintages: Vintage[]; horizon: number }) {
  const max = Math.max(1, ...vintages.map((v) => v.amount));
  const byMonth = new Map(vintages.map((v) => [v.month, v.amount]));
  return (
    <div>
      <div dir="ltr" className="flex h-12 items-end gap-px rounded-lg bg-slate-100/80 p-1 dark:bg-slate-800/60">
        {Array.from({ length: horizon + 1 }, (_, t) => {
          const a = byMonth.get(t) ?? 0;
          return (
            <div
              key={t}
              className="flex-1 rounded-t-sm transition-all"
              style={{
                height: a > 0 ? `${Math.max(8, (a / max) * 100)}%` : '2px',
                background: a > 0 ? '#6366f1' : 'rgba(148,163,184,0.35)',
              }}
              title={`ماه ${toFa(t)}`}
            />
          );
        })}
      </div>
      <div dir="ltr" className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>t = {toFa(0)}</span>
        <span>{toFa(Math.round(horizon / 2))}</span>
        <span>{toFa(horizon)}</span>
      </div>
    </div>
  );
}

function ScheduleEditor({
  schedule,
  onChange,
  horizon,
  vintages,
  total,
}: {
  schedule: DepositSchedule;
  onChange: (s: DepositSchedule) => void;
  horizon: number;
  vintages: Vintage[];
  total: number;
}) {
  const inHorizon = (v: CustomVintage) => Math.round(v.month) >= 0 && Math.round(v.month) <= horizon;
  // موتور فقط ویژه‌های درون‌افق را نرمال می‌کند؛ پیش‌نمایش ریالی هم باید دقیقاً همان
  // مخرج را استفاده کند، وگرنه ارقام جدول با ماتریس نقدینگی نمی‌خواند.
  const sum = schedule.custom.reduce((s, v) => s + (inHorizon(v) ? Math.max(0, v.share) : 0), 0);
  const dropped = schedule.custom.filter((v) => !inHorizon(v)).length;
  const updateV = (id: string, patch: Partial<{ month: number; share: number }>) =>
    onChange({ ...schedule, custom: schedule.custom.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  const removeV = (id: string) => onChange({ ...schedule, custom: schedule.custom.filter((v) => v.id !== id) });
  const addV = () => {
    const last = schedule.custom.reduce((m, v) => Math.max(m, v.month), -1);
    onChange({
      ...schedule,
      custom: [...schedule.custom, { id: uid(), month: Math.min(horizon, last + 1), share: Math.max(0, Math.round((100 - sum) * 10) / 10) || 10 }],
    });
  };
  const n = uniformVintageCount(schedule, horizon);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200/80 p-3.5 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700 dark:text-slate-200">
          <CalendarClock className="h-4 w-4 text-indigo-500" />
          زمان‌بندی ورود منابع (ویژه‌ها / Vintages)
        </span>
        <Badge tone="indigo">{toFa(vintages.length)} ویژه</Badge>
      </div>
      <Segmented
        full
        size="sm"
        value={schedule.mode}
        onChange={(mode) => onChange({ ...schedule, mode })}
        options={[
          { value: 'lump', label: 'یکجا در ماه ۰' },
          { value: 'uniform', label: 'توزیع یکنواخت' },
          { value: 'custom', label: 'زمان‌بندی سفارشی' },
        ]}
      />

      {schedule.mode === 'lump' && (
        <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
          کل منابع در ماه <b>t = ۰</b> وارد می‌شود و تمام پله‌ها یک ویژه واحد را تشکیل می‌دهند.
        </p>
      )}

      {schedule.mode === 'uniform' && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
          <span>جذب در</span>
          <NumField
            size="sm"
            value={schedule.uniformMonths}
            min={1}
            max={horizon + 1}
            onChange={(v) => onChange({ ...schedule, uniformMonths: Math.round(v) })}
            suffix="ماه"
            className="w-[100px]"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            (ماه ۰ تا {toFa(n - 1)}، هر ماه <Money compact value={total / n} />)
          </span>
        </div>
      )}

      {schedule.mode === 'custom' && (
        <div className="space-y-2">
          {schedule.custom.length === 0 && <p className="text-[11px] text-slate-400">هیچ ویژه‌ای ثبت نشده است.</p>}
          {schedule.custom.map((v) => {
            const out = !inHorizon(v);
            return (
              <div
                key={v.id}
                className={
                  'flex flex-wrap items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300' +
                  (out ? ' opacity-60' : '')
                }
              >
                <span>ماه</span>
                <NumField
                  size="sm"
                  value={v.month}
                  min={0}
                  max={horizon}
                  onChange={(m) => updateV(v.id, { month: Math.round(m) })}
                  className="w-[64px]"
                />
                <span>سهم</span>
                <NumField
                  size="sm"
                  value={v.share}
                  min={0}
                  max={100}
                  decimals={1}
                  onChange={(s) => updateV(v.id, { share: s })}
                  suffix="٪"
                  className="w-[88px]"
                />
                <span className="flex-1 text-left text-[11px] text-slate-500 dark:text-slate-400">
                  {out ? (
                    <Badge tone="amber">خارج از افق — در محاسبه لحاظ نمی‌شود</Badge>
                  ) : (
                    <Money compact value={sum > 0 ? (total * Math.max(0, v.share)) / sum : 0} />
                  )}
                </span>
                <button
                  type="button"
                  title="حذف ویژه"
                  onClick={() => removeV(v.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={addV}>
              <Plus />
              افزودن ویژه
            </Button>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              مجموع سهم (ویژه‌های درون‌افق):{' '}
              <b className={Math.abs(sum - 100) < 0.05 ? 'text-emerald-600' : 'text-amber-600'}>{fmtPct(sum, 1)}</b>
              {Math.abs(sum - 100) >= 0.05 && ' — نرمال‌سازی خودکار'}
              {dropped > 0 && ` · ${toFa(dropped)} ویژه خارج از افق حذف و سهم‌ها بازمقیاس شد`}
            </span>
          </div>
        </div>
      )}

      <VintageStrip vintages={vintages} horizon={horizon} />
    </div>
  );
}

interface Props {
  behavior: Behavior;
  onBehavior: (patch: Partial<Behavior>) => void;
  schedule: DepositSchedule;
  onSchedule: (s: DepositSchedule) => void;
  config: GlobalConfig;
  result: SimResult;
}

export function CommitmentPanel({ behavior, onBehavior, schedule, onSchedule, config, result }: Props) {
  const { unit, factor } = useDisplay();
  const cf = commitmentFactor(behavior);
  const wf = withdrawalFactor(behavior);

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <Card className="xl:col-span-5">
        <CardHeader
          icon={<Wallet />}
          title="ورود دستی منابع و متغیرهای رفتاری"
          subtitle="مبلغ کل سپرده، زمان‌بندی ویژه‌ها و رفتار متقاضیان — موتور تعهدات بلادرنگ بازمحاسبه می‌شود"
        />
        <div className="space-y-5 p-5">
          <Field
            label="کل منابع (سپرده) جذب‌شده"
            hint={
              <>
                معادل <b className="text-slate-600 dark:text-slate-300">{fmtCompact(behavior.totalDeposit * factor)}</b> {unit}
              </>
            }
          >
            <NumField
              money
              size="lg"
              value={behavior.totalDeposit}
              min={0}
              max={1e16}
              onChange={(v) => onBehavior({ totalDeposit: v })}
              suffix={unit}
              ariaLabel="کل منابع"
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onBehavior({ totalDeposit: q })}
                  className={
                    'rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition ' +
                    (Math.abs(behavior.totalDeposit - q) < 1
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:ring-indigo-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700')
                  }
                >
                  {fmtCompact(q * factor)}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="میانگین سپرده هر مشتری"
            info="مانده مبنا = max(این مقدار ، حداقل مانده پله). برای اعمال سقف فردی تسهیلات (α_eff) و برآورد تعداد وام‌گیرندگان استفاده می‌شود."
            hint="فرض رفتاری برای اعمال سقف فردی و برآورد تعداد متقاضیان"
          >
            <NumField money value={behavior.avgTicket} min={0} onChange={(v) => onBehavior({ avgTicket: v })} suffix={unit} />
          </Field>

          <ScheduleEditor
            schedule={schedule}
            onChange={onSchedule}
            horizon={config.horizon}
            vintages={result.vintages}
            total={behavior.totalDeposit}
          />

          <div className="space-y-3">
            <SliderField
              label="نرخ تقاضای وام"
              symbol="ρ_take"
              icon={<Users />}
              value={behavior.takeUpRate}
              onChange={(v) => onBehavior({ takeUpRate: v })}
              color="#6366f1"
              hint="سهم سپرده‌گذاران واجد شرایط که در سررسید، درخواست تسهیلات ثبت می‌کنند."
            />
            <SliderField
              label="نرخ قبولی اعتبارسنجی"
              symbol="ρ_app"
              icon={<UserCheck />}
              value={behavior.approvalRate}
              onChange={(v) => onBehavior({ approvalRate: v })}
              color="#0ea5e9"
              hint="درصد متقاضیانی که از فیلتر رتبه‌بندی اعتباری و تضامین عبور می‌کنند."
            />
            <SliderField
              label="نرخ خروج سپرده وام‌گیرندگان"
              symbol="ω_with"
              icon={<TrendingDown />}
              value={behavior.runoffRate}
              onChange={(v) => onBehavior({ runoffRate: v })}
              color="#f43f5e"
              hint="به دلیل ممنوعیت مسدودسازی سپرده، وام‌گیرنده همزمان با دریافت وام اصل سپرده را برداشت می‌کند."
            />
            <SliderField
              label="نرخ خروج سپرده انصراف‌دهندگان"
              symbol="ω_churn"
              icon={<LogOut />}
              value={behavior.churnRate}
              onChange={(v) => onBehavior({ churnRate: v })}
              color="#f59e0b"
              hint="برداشت مانده توسط سپرده‌گذارانی که از دریافت وام انصراف می‌دهند."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-indigo-50/70 p-3 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:ring-indigo-500/20">
              <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">ضریب تبدیل تعهد</div>
              <div className="mt-1 text-lg font-black text-indigo-700 dark:text-indigo-200">{fmtPct(cf * 100, 1)}</div>
              <div dir="ltr" className="text-left font-mono text-[10px] text-indigo-500/80">ρ_take × ρ_app</div>
            </div>
            <div className="rounded-xl bg-rose-50/70 p-3 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:ring-rose-500/20">
              <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">ضریب خروج سپرده</div>
              <div className="mt-1 text-lg font-black text-rose-700 dark:text-rose-200">{fmtPct(wf * 100, 1)}</div>
              <div dir="ltr" className="text-left font-mono text-[10px] text-rose-500/80">ρ·ω_with + (1−ρ)·ω_churn</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-6 xl:col-span-7">
        <KpiBoard result={result} config={config} />
        <TierCommitmentTable result={result} />
      </div>
    </div>
  );
}

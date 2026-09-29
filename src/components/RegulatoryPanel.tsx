import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertOctagon, CalendarRange, Droplets, Ruler, Scale, ShieldCheck } from 'lucide-react';
import type { GlobalConfig } from '../types';
import { DEFAULT_REGULATORY, type Regulatory, type RegulatoryParams } from '../lib/regulatory';
import { fmtCompact, fmtNumber, fmtPct, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Field, Money, SliderField } from './ui';
import { cn } from '../utils/cn';

interface Props {
  config: GlobalConfig;
  params: RegulatoryParams;
  onParams: (p: Partial<RegulatoryParams>) => void;
  /** سنجه‌های محاسبه‌شده — در ریشهٔ برنامه یک‌بار حساب می‌شوند و با نردبان سررسید مشترک‌اند */
  reg: Regulatory;
}

function Tile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const tones = {
    emerald: 'text-emerald-600 dark:text-emerald-300',
    amber: 'text-amber-600 dark:text-amber-300',
    rose: 'text-rose-600 dark:text-rose-300',
    slate: 'text-slate-700 dark:text-slate-200',
  } as const;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-2 text-[11.5px] font-bold text-slate-500 dark:text-slate-400">
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {label}
      </div>
      <div className={cn('mt-1 text-[24px] font-black leading-8 tabular-nums', tones[tone])}>{value}</div>
      <div className="mt-0.5 text-[10.5px] leading-4 text-slate-400 dark:text-slate-500">{hint}</div>
    </div>
  );
}

function LcrTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: LcrDatum }> }) {
  const { unit } = useDisplay();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div
      dir="rtl"
      className="min-w-[220px] rounded-xl border border-slate-200 bg-white/95 p-3 text-[11.5px] text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
    >
      <div className="mb-1.5 text-[13px] font-extrabold">ماه {toFa(d.t)}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-500 dark:text-slate-400">نسبت پوشش نقدینگی</span>
        <b className={d.lcr === null ? '' : d.lcr < 100 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
          {d.lcr === null ? '∞' : fmtPct(d.lcr, 1)}
        </b>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-500 dark:text-slate-400">دارایی نقد (HQLA)</span>
        <b>
          <Money compact value={d.hqla} />
        </b>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-500 dark:text-slate-400">خروج استرس‌شده</span>
        <b>
          <Money compact value={d.outflow} />
        </b>
      </div>
      <div className="mt-1 text-[10px] text-slate-400">ارقام به {unit}</div>
    </div>
  );
}

interface LcrDatum {
  t: number;
  lcr: number | null;
  hqla: number;
  outflow: number;
}

function ratioTone(v: number | null, threshold = 100): 'emerald' | 'amber' | 'rose' | 'slate' {
  if (v === null) return 'slate';
  if (v >= threshold) return 'emerald';
  if (v >= threshold * 0.8) return 'amber';
  return 'rose';
}

/**
 * سنجه‌های مقرراتی‌مانند: LCR ماهانه، NSFR در ماه ۱۲ و شکاف سررسید (WAL).
 * همهٔ ضرایب ورودی کاربرند؛ این سنجه‌ها جایگزین محاسبات رسمی ناظر نیستند.
 */
export function RegulatoryPanel({ config, params, onParams, reg }: Props) {
  const { dark, factor } = useDisplay();
  const horizon = Math.round(config.horizon);

  const data = useMemo<LcrDatum[]>(
    () => reg.lcr.map((p) => ({ t: p.month, lcr: p.lcr === null ? null : p.lcr, hqla: p.hqla, outflow: p.outflow })),
    [reg.lcr],
  );
  const lcrMax = Math.max(100, ...data.map((d) => (d.lcr === null ? 0 : Math.min(d.lcr, 1000))));
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
        icon={<ShieldCheck />}
        title="سنجه‌های مقرراتی‌مانند (LCR / NSFR / شکاف سررسید)"
        subtitle="نسبت پوشش نقدینگی ماهانه، تأمین مالی پایدار و میانگین وزنی عمر دارایی و تعهد — با ضرایب قابل تنظیم کاربر"
        actions={
          <>
            <Badge tone="amber">
              <AlertOctagon />
              تقریب آموزشی
            </Badge>
            <Badge tone="slate">افق {toFa(horizon)} ماهه</Badge>
          </>
        }
      />

      <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-3 dark:border-slate-800">
        <SliderField
          label="خروج استرس سپردهٔ خرد"
          symbol="ω"
          value={params.stressRunoff}
          onChange={(v) => onParams({ stressRunoff: v })}
          min={0}
          max={30}
          step={0.5}
          color="#f43f5e"
          icon={<Droplets />}
          hint="درصد اضافی از ماندهٔ سپردهٔ خرد که در سناریوی استرس، خروج فرض می‌شود"
        />
        <SliderField
          label="ضریب پایداری منابع (ASF)"
          symbol="w"
          value={params.stableWeight}
          onChange={(v) => onParams({ stableWeight: v })}
          min={0}
          max={100}
          step={1}
          color="#10b981"
          icon={<Scale />}
          hint="سهمی از ماندهٔ سپرده که تأمین مالی پایدار تلقی می‌شود"
        />
        <SliderField
          label="ضریب نیاز به تأمین (RSF)"
          symbol="r"
          value={params.loanWeight}
          onChange={(v) => onParams({ loanWeight: v })}
          min={0}
          max={100}
          step={1}
          color="#6366f1"
          icon={<Ruler />}
          hint="سهمی از ماندهٔ تسهیلات که باید با منابع پایدار تأمین شود"
        />
      </div>

      <div className="grid gap-3 border-b border-slate-100 p-5 pt-4 sm:grid-cols-3 dark:border-slate-800">
        <SliderField
          label="سهم سپردهٔ کلان/شرکتی"
          symbol="s"
          value={params.wholesaleShare}
          onChange={(v) => onParams({ wholesaleShare: v })}
          min={0}
          max={100}
          step={1}
          color="#f59e0b"
          icon={<Droplets />}
          hint="سهم سپرده‌های کلان از مانده؛ خروج استرس آن‌ها با نرخ جداگانه وزن می‌شود"
        />
        <SliderField
          label="خروج استرس سپردهٔ کلان"
          symbol="ω_w"
          value={params.wholesaleRunoff}
          onChange={(v) => onParams({ wholesaleRunoff: v })}
          min={0}
          max={100}
          step={1}
          color="#ef4444"
          icon={<Droplets />}
          hint={`نرخ خروج استرس سپردهٔ کلان — نرخ مؤثر ترکیبی: ${fmtPct(reg.effStressRunoff, 1)}`}
        />
        <SliderField
          label="تنزیل دارایی نقد (Haircut)"
          symbol="h"
          value={params.hqlaHaircut}
          onChange={(v) => onParams({ hqlaHaircut: v })}
          min={0}
          max={50}
          step={0.5}
          color="#8b5cf6"
          icon={<ShieldCheck />}
          hint="درصد تنزیل مازاد نقدینگی در صورت‌حساب LCR (کیفیت پایین‌تر دارایی نقد)"
        />
      </div>

      <div className="grid gap-3 p-5 pb-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<Droplets />}
          tone={ratioTone(reg.minLcr)}
          label="کمینهٔ LCR در افق"
          value={reg.minLcr === null ? '∞' : fmtPct(reg.minLcr, 1)}
          hint={
            reg.minLcrMonth === null
              ? 'هیچ ماهی خروج خالص نداشت'
              : `در ماه ${toFa(reg.minLcrMonth)} · آستانهٔ مرجع ۱۰۰٪`
          }
        />
        <Tile
          icon={<AlertOctagon />}
          tone={reg.monthsBelow100 > 0 ? 'rose' : 'emerald'}
          label="ماه‌های زیر ۱۰۰٪"
          value={toFa(reg.monthsBelow100)}
          hint="تعداد ماه‌هایی که دارایی نقد، خروج استرس‌شده را پوشش نمی‌دهد"
        />
        <Tile
          icon={<Scale />}
          tone={ratioTone(reg.nsfr)}
          label={`NSFR در ماه ${toFa(reg.nsfrMonth)}`}
          value={reg.nsfr === null ? '—' : fmtPct(reg.nsfr, 1)}
          hint={
            horizon < 12
              ? 'افق کوتاه‌تر از ۱۲ ماه — در آخرین ماه محاسبه شد'
              : `منابع پایدار ${fmtCompact(reg.asf * factor)} ÷ دارایی نیازمند تأمین ${fmtCompact(reg.rsf * factor)}`
          }
        />
        <Tile
          icon={<CalendarRange />}
          tone={reg.maturityGap === null ? 'slate' : reg.maturityGap >= 0 ? 'emerald' : 'rose'}
          label="شکاف سررسید (WAL)"
          value={reg.maturityGap === null ? '—' : `${fmtNumber(reg.maturityGap, 1, true)} ماه`}
          hint="میانگین وزنی عمر دارایی منهای میانگین وزنی عمر تعهدات"
        />
      </div>

      <div className="px-5 pb-2 text-[11.5px] text-slate-500 dark:text-slate-400">
        نمودار پوشش نقدینگی ماهانه — خط چین سرخ آستانهٔ ۱۰۰٪ است
      </div>
      <div dir="ltr" className="px-2 pb-4 sm:px-4">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
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
              tickFormatter={(v: number) => fmtRaw(v)}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={54}
              domain={[0, Math.ceil(lcrMax / 50) * 50]}
            />
            <Tooltip content={<LcrTooltip />} cursor={{ stroke: dark ? '#475569' : '#cbd5e1' }} />
            <ReferenceLine y={100} stroke="#f43f5e" strokeDasharray="5 4" strokeOpacity={0.8} />
            <Area
              type="monotone"
              dataKey="lcr"
              stroke="#0ea5e9"
              strokeWidth={2.2}
              fill="#0ea5e9"
              fillOpacity={dark ? 0.16 : 0.1}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto border-t border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="WAL دارایی‌ها (بازگشت اصل سرمایه)">
            <div className="text-[15px] font-black tabular-nums">
              {reg.walAssets === null ? '—' : `${fmtNumber(reg.walAssets, 2, true)} ماه`}
            </div>
          </Field>
          <Field label="WAL تعهدات (برداشت + سود سپرده + ماندهٔ افق)">
            <div className="text-[15px] font-black tabular-nums">
              {reg.walLiabilities === null ? '—' : `${fmtNumber(reg.walLiabilities, 2, true)} ماه`}
            </div>
          </Field>
          <Field label="نرخ بازیافت اصل در افق">
            <div className="text-[15px] font-black tabular-nums">
              {reg.recoveryRate === null ? '—' : fmtPct(reg.recoveryRate * 100, 1)}
            </div>
          </Field>
          <Field label="ماندهٔ سپردهٔ زنده در افق">
            <div className="text-[15px] font-black tabular-nums">
              <Money compact value={reg.depositSurvival} unit />
            </div>
          </Field>
          <Field label="منابع پایدار (ASF) در ماه محاسبه">
            <div className="text-[15px] font-black tabular-nums">
              <Money compact value={reg.asf} unit />
            </div>
          </Field>
          <Field label="دارایی نیازمند تأمین (RSF) در ماه محاسبه">
            <div className="text-[15px] font-black tabular-nums">
              <Money compact value={reg.rsf} unit />
            </div>
          </Field>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-100 px-5 py-3.5 text-[11px] leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <div dir="ltr" className="text-left font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
          LCR(t) = max(0, CumLiq(t)) × (1 − h) ÷ [ Outflow(t) + ω_eff × DepositBalance(t) ] × 100
          <br />
          ω_eff = (1 − s) × ω_retail + s × ω_wholesale
          <br />
          NSFR(m) = [ DepositBalance(m) × w ] ÷ [ LoanBook(m) × r ] × 100 &nbsp;(m = 12؛ در افق کوتاه‌تر، آخرین ماه)
          <br />
          WAL = Σ t × Flow(t) ÷ Σ Flow(t) &nbsp;·&nbsp; Gap = WAL(assets) − WAL(liabilities)
        </div>
        <div>
          در محاسبهٔ LCR، «دارایی نقد» همان مازاد نقدینگی تجمعی مثبت پس از تنزیل (haircut) است و خروج استرس با نرخ مؤثر
          ترکیبی سپردهٔ خرد و کلان وزن می‌شود؛ ماه‌هایی که خروج خالص ندارند (پوشش نامحدود) از محاسبهٔ کمینه کنار گذاشته
          می‌شوند. در WAL تعهدات، ماندهٔ سپرده‌ای که تا پایان افق زنده می‌ماند به‌عنوان تعهدی با سررسید باز در ماه آخر لحاظ
          می‌شود. ضریب پیش‌فرض‌ها: خروج استرس خرد {fmtPct(DEFAULT_REGULATORY.stressRunoff, 1)}، پایداری منابع{' '}
          {fmtPct(DEFAULT_REGULATORY.stableWeight, 0)}، نیاز به تأمین {fmtPct(DEFAULT_REGULATORY.loanWeight, 0)}، سهم کلان{' '}
          {fmtPct(DEFAULT_REGULATORY.wholesaleShare, 0)}، خروج استرس کلان {fmtPct(DEFAULT_REGULATORY.wholesaleRunoff, 0)} و تنزیل {fmtPct(DEFAULT_REGULATORY.hqlaHaircut, 0)} — همه قابل تغییر
          توسط شما و بدون هیچ عدد ثابت در موتور.
          <br />
          <b className="text-slate-600 dark:text-slate-300">
            این سنجه‌ها نسخهٔ ساده‌شده و آموزشی‌اند و جایگزین تعاریف رسمی کمیتهٔ بال یا الزامات ناظر داخلی نیستند.
          </b>
        </div>
      </div>
    </Card>
  );
}

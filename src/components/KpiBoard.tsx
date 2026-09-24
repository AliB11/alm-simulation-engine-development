import type { ReactNode } from 'react';
import { HandCoins, Hourglass, Scale, ShieldCheck, Target, TrendingDown, TriangleAlert, Users } from 'lucide-react';
import type { GlobalConfig, SimResult } from '../types';
import { fmtNumber, fmtPct, fmtRatio, toFa } from '../lib/format';
import { tierColor } from '../lib/presets';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Money } from './ui';
import { cn } from '../utils/cn';

type KTone = 'indigo' | 'amber' | 'rose' | 'emerald';

const KTONES: Record<KTone, { icon: string; glow: string; value: string }> = {
  indigo: {
    icon: 'bg-indigo-50 text-indigo-600 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20',
    glow: 'bg-indigo-500/10',
    value: 'text-slate-900 dark:text-white',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
    glow: 'bg-amber-500/10',
    value: 'text-slate-900 dark:text-white',
  },
  rose: {
    icon: 'bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20',
    glow: 'bg-rose-500/15',
    value: 'text-rose-600 dark:text-rose-400',
  },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
    glow: 'bg-emerald-500/10',
    value: 'text-emerald-600 dark:text-emerald-400',
  },
};

function KpiCard({
  tone,
  icon,
  label,
  value,
  sub,
  footer,
  formula,
}: {
  tone: KTone;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  formula?: string;
}) {
  const t = KTONES[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div className={cn('pointer-events-none absolute -left-12 -top-12 h-36 w-36 rounded-full blur-2xl', t.glow)} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="text-[12.5px] font-bold leading-6 text-slate-500 dark:text-slate-400">{label}</div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 [&>svg]:h-[18px] [&>svg]:w-[18px]', t.icon)}>
          {icon}
        </div>
      </div>
      <div className={cn('relative mt-1 text-[26px] font-black leading-10 tracking-tight', t.value)}>{value}</div>
      {sub && <div className="relative text-[11px] text-slate-400 dark:text-slate-500">{sub}</div>}
      {footer && (
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-200 pt-2.5 text-[11.5px] text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
          {footer}
        </div>
      )}
      {formula && (
        <div dir="ltr" className="relative mt-2 truncate text-left font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
          {formula}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'rose' | 'emerald' }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={cn(
          'mt-1 text-[15px] font-extrabold text-slate-800 dark:text-slate-100',
          tone === 'rose' && 'text-rose-600 dark:text-rose-400',
          tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">{sub}</div>}
    </div>
  );
}

export function RiskBanner({ result, horizon }: { result: SimResult; horizon: number }) {
  const k = result.kpis;
  const { unit } = useDisplay();
  if (k.totalDeposit <= 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
        هنوز منابعی ثبت نشده است. مبلغ کل سپرده جذب‌شده را وارد کنید.
      </div>
    );
  }
  if (k.tippingPoint === null) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-linear-to-l from-emerald-50 to-white p-4 dark:border-emerald-500/25 dark:from-emerald-500/10 dark:to-transparent">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="text-[12.5px] leading-6 text-emerald-900 dark:text-emerald-100">
          <div className="text-[14px] font-extrabold">ساختار محصول در افق {toFa(horizon)} ماهه از نظر نقدینگی پایدار است</div>
          مانده نقدینگی تجمعی در تمام ماه‌ها مثبت باقی می‌ماند. کمترین تراز <b><Money compact value={k.minCum} /></b> {unit} در ماه{' '}
          {toFa(k.minCumMonth)} رخ می‌دهد و ضریب اهرم خروج {fmtRatio(k.leverage)}× است.
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-linear-to-l from-rose-50 to-white p-4 dark:border-rose-500/25 dark:from-rose-500/10 dark:to-transparent">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/30">
        <TriangleAlert className="h-5 w-5" />
      </div>
      <div className="text-[12.5px] leading-6 text-rose-900 dark:text-rose-100">
        <div className="text-[14px] font-extrabold">هشدار ریسک نقدینگی — واژگونی خزانه در ماه {toFa(k.tippingPoint)}</div>
        عمیق‌ترین فرورفتگی نقدینگی به <b><Money compact value={-k.maxHole} /></b> {unit} در ماه {toFa(k.minCumMonth)} می‌رسد؛{' '}
        {k.recoveryMonth !== null
          ? `تراز تجمعی در ماه ${toFa(k.recoveryMonth)} دوباره مثبت می‌شود`
          : 'تا پایان افق شبیه‌سازی، تراز مثبت بازیابی نمی‌شود'}{' '}
        ({toFa(k.deficitMonths)} ماه در کسری). حداقل خط اعتباری / اضافه‌برداشت لازم از بازار بین‌بانکی:{' '}
        <b><Money compact value={k.maxHole} /></b> {unit}.
      </div>
    </div>
  );
}

export function KpiBoard({ result, config }: { result: SimResult; config: GlobalConfig }) {
  const k = result.kpis;
  const { unit } = useDisplay();
  const levTone: KTone = k.leverage > 1 ? 'rose' : k.leverage > 0.8 ? 'amber' : 'emerald';
  const levPct = Math.min(100, (k.leverage / 3) * 100);

  return (
    <div className="space-y-4">
      <RiskBanner result={result} horizon={config.horizon} />

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          tone="indigo"
          icon={<HandCoins />}
          label="کل تعهد اعطای وام به متقاضیان"
          value={<Money compact value={k.totalCommitment} />}
          sub={<Money value={k.totalCommitment} unit />}
          footer={
            <>
              <span>{fmtPct(k.totalDeposit > 0 ? (k.totalCommitment / k.totalDeposit) * 100 : 0, 1)} از کل منابع</span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {k.borrowers > 0 ? (
                  <>≈ {fmtNumber(k.borrowers)} وام‌گیرنده</>
                ) : (
                  <>برآورد وام‌گیرنده: —</>
                )}
              </span>
            </>
          }
          formula="Σ D_k × α_k × ρ_take × ρ_app"
        />
        <KpiCard
          tone="amber"
          icon={<TrendingDown />}
          label="حجم کل خروج پیش‌بینی‌شده سپرده‌ها"
          value={<Money compact value={k.totalWithdrawal} />}
          sub={<Money value={k.totalWithdrawal} unit />}
          footer={
            <>
              <span>{fmtPct(k.totalDeposit > 0 ? (k.totalWithdrawal / k.totalDeposit) * 100 : 0, 1)} از کل سپرده</span>
              <span>
                سپرده ماندگار: <Money compact value={k.totalDeposit - k.totalWithdrawal} />
              </span>
            </>
          }
          formula="Σ D_k × [ρ_take·ω_with + (1−ρ_take)·ω_churn]"
        />
        <KpiCard
          tone={levTone}
          icon={<Scale />}
          label="ضریب اهرم خروج نقدینگی"
          value={`${fmtRatio(k.leverage)}×`}
          sub={
            k.leverage === Infinity
              ? 'منابع ورودی خالص صفر است — هر خروجی بدون پوشش منابع انجام می‌شود'
              : '(تعهد وام + خروج سپرده) ÷ منابع ورودی خالص'
          }
          footer={
            <div className="w-full">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={cn(
                    'absolute inset-y-0 right-0 rounded-full',
                    levTone === 'rose' ? 'bg-rose-500' : levTone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500',
                  )}
                  style={{ width: `${levPct}%` }}
                />
                <div className="absolute inset-y-0 w-0.5 bg-slate-500/70" style={{ right: `${100 / 3}%` }} title="آستانه ۱×" />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>۰×</span>
                <span>آستانه ۱× (خروج = منابع)</span>
                <span>۳×</span>
              </div>
            </div>
          }
        />
        <KpiCard
          tone={k.maxHole > 0 ? 'rose' : 'emerald'}
          icon={<Target />}
          label="ماکزیمم کسری نقدینگی تجمعی"
          value={k.maxHole > 0 ? <Money compact value={-k.maxHole} /> : 'بدون کسری'}
          sub={
            k.maxHole > 0 ? (
              <Money value={-k.maxHole} unit />
            ) : (
              <>
                کمترین تراز تجمعی: <Money compact value={k.minCum} unit /> (ماه {toFa(k.minCumMonth)})
              </>
            )
          }
          footer={
            <>
              <span className="flex items-center gap-1">
                <Hourglass className="h-3.5 w-3.5" />
                ماه وقوع بحران: <b>{k.maxHole > 0 ? toFa(k.minCumMonth) : '—'}</b>
              </span>
              <span>
                نقطه واژگونی: <b>{k.tippingPoint === null ? '—' : `ماه ${toFa(k.tippingPoint)}`}</b>
              </span>
            </>
          }
          formula="Max Hole = min(CumLiq_t)"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MiniStat
          label="منابع خالص قابل استفاده"
          value={<Money compact value={k.netDeposit} />}
          sub={`پس از کسر ${fmtPct(config.reserveRatio)} سپرده قانونی`}
        />
        <MiniStat
          label="مانده نقدینگی پایان افق"
          value={<Money compact value={k.endCum} />}
          tone={k.endCum < 0 ? 'rose' : 'emerald'}
          sub={`ماه ${toFa(config.horizon)} · ${unit}`}
        />
        <MiniStat
          label="بازگشت به تراز مثبت"
          value={
            k.tippingPoint === null ? 'نیاز نیست' : k.recoveryMonth !== null ? `ماه ${toFa(k.recoveryMonth)}` : 'خارج از افق'
          }
          tone={k.tippingPoint !== null && k.recoveryMonth === null ? 'rose' : undefined}
          sub={`${toFa(k.deficitMonths)} ماه در وضعیت کسری`}
        />
        <MiniStat
          label="هزینه پوشش کسری (بین‌بانکی)"
          value={<Money compact value={k.interbankCost} />}
          sub={`با نرخ ${fmtPct(config.interbankRate)} سالانه`}
        />
      </div>

      {(k.commitmentsBeyondHorizon > 0.5 || k.pmtBeyondHorizon > 0.5) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[11.5px] leading-6 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            بخشی از جریان‌ها خارج از افق {toFa(config.horizon)} ماهه رخ می‌دهد و در نمودارها لحاظ نشده است:
            {k.commitmentsBeyondHorizon > 0.5 && (
              <>
                {' '}تعهد/برداشت سررسیدنشده <b><Money compact value={k.commitmentsBeyondHorizon} /></b> {unit}
              </>
            )}
            {k.pmtBeyondHorizon > 0.5 && (
              <>
                {k.commitmentsBeyondHorizon > 0.5 ? ' و' : ''} اقساط وصول‌نشده <b><Money compact value={k.pmtBeyondHorizon} /></b> {unit}
              </>
            )}
            . برای تصویر کامل، افق شبیه‌سازی را افزایش دهید.
          </span>
        </div>
      )}
    </div>
  );
}

export function TierCommitmentTable({ result }: { result: SimResult }) {
  const { unit } = useDisplay();
  const rows = result.tiers;
  const tot = rows.reduce(
    (a, r) => ({
      deposit: a.deposit + r.deposit,
      commitment: a.commitment + r.commitment,
      withdrawal: a.withdrawal + r.withdrawal,
      pmt: a.pmt + r.monthlyPmt,
      borrowers: a.borrowers + r.borrowers,
    }),
    { deposit: 0, commitment: 0, withdrawal: 0, pmt: 0, borrowers: 0 },
  );
  const th = 'px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap';
  const td = 'px-3 py-2.5 whitespace-nowrap border-b border-slate-100 dark:border-slate-800';

  return (
    <Card>
      <CardHeader
        icon={<HandCoins />}
        title="وضعیت تعهدات به تفکیک پله (Double Liquidity Drain)"
        subtitle={`تعهد وام و خروج سپرده در ماه سررسید T_dep به صورت همزمان رخ می‌دهد — ارقام به ${unit}. پله‌ای که وامی اعطا نمی‌کند، وام‌گیرنده‌ای هم ندارد و خروج سپرده‌اش فقط با ω_churn برآورد می‌شود.`}
      />
      <div className="alm-scroll overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12.5px]">
          <thead className="bg-slate-50 dark:bg-slate-950/40">
            <tr>
              <th className={th}>پله</th>
              <th className={th}>سپرده تخصیصی</th>
              <th className={th}>ماه سررسید</th>
              <th className={th}>تعهد وام</th>
              <th className={th}>خروج سپرده</th>
              <th className={th}>جمع خروجی</th>
              <th className={th}>قسط ماهانه کل</th>
              <th className={th}>وام‌گیرنده</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tier.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: tierColor(r.index) }} />
                    <span className="max-w-[180px] truncate font-semibold text-slate-700 dark:text-slate-200">{r.tier.name}</span>
                    {!r.lends && r.deposit > 0 && (
                      <span title={r.eligible ? 'ضریب برابری این پله صفر است' : 'میانگین سپرده مشتری به حداقل مانده این پله نمی‌رسد'}>
                        <Badge tone="slate">بدون اعطا</Badge>
                      </span>
                    )}
                  </div>
                </td>
                <td className={td}>
                  <Money compact value={r.deposit} />
                  <span className="ms-1 text-[10.5px] text-slate-400">({fmtPct(r.share * 100, 1)})</span>
                </td>
                <td className={td}>
                  {r.firstMaturity === null ? (
                    '—'
                  ) : r.firstMaturity === r.lastMaturity ? (
                    <Badge tone="amber">ماه {toFa(r.firstMaturity)}</Badge>
                  ) : (
                    <Badge tone="amber">
                      ماه {toFa(r.firstMaturity)} تا {toFa(r.lastMaturity ?? r.firstMaturity)}
                    </Badge>
                  )}
                </td>
                <td className={cn(td, 'font-semibold text-indigo-600 dark:text-indigo-300')}>
                  <Money compact value={r.commitment} />
                </td>
                <td className={cn(td, 'font-semibold text-amber-600 dark:text-amber-400')}>
                  <Money compact value={r.withdrawal} />
                </td>
                <td className={cn(td, 'font-bold text-rose-600 dark:text-rose-400')}>
                  <Money compact value={r.commitment + r.withdrawal} />
                </td>
                <td className={td}>
                  <Money compact value={r.monthlyPmt} />
                  <span className="ms-1 text-[10.5px] text-slate-400">× {toFa(r.tier.tLoan)}</span>
                </td>
                <td className={td}>{r.borrowers > 0 ? fmtNumber(r.borrowers) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-bold dark:bg-slate-950/40">
              <td className="px-3 py-2.5">جمع کل</td>
              <td className="px-3 py-2.5">
                <Money compact value={tot.deposit} />
              </td>
              <td className="px-3 py-2.5">—</td>
              <td className="px-3 py-2.5 text-indigo-600 dark:text-indigo-300">
                <Money compact value={tot.commitment} />
              </td>
              <td className="px-3 py-2.5 text-amber-600 dark:text-amber-400">
                <Money compact value={tot.withdrawal} />
              </td>
              <td className="px-3 py-2.5 text-rose-600 dark:text-rose-400">
                <Money compact value={tot.commitment + tot.withdrawal} />
              </td>
              <td className="px-3 py-2.5">
                <Money compact value={tot.pmt} />
              </td>
              <td className="px-3 py-2.5">{tot.borrowers > 0 ? fmtNumber(tot.borrowers) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

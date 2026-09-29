import { useMemo, useState } from 'react';
import { Calculator, Crown } from 'lucide-react';
import type { GlobalConfig, Tier } from '../types';
import { sampleComparison } from '../lib/engine';
import { fmtCompact, fmtPct, toFa } from '../lib/format';
import { tierColor } from '../lib/presets';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Money, NumField } from './ui';
import { cn } from '../utils/cn';

const SAMPLES = [50_000_000, 100_000_000, 200_000_000, 500_000_000];

export function TierComparison({
  tiers,
  config,
  onOpportunityRate,
}: {
  tiers: Tier[];
  config: GlobalConfig;
  onOpportunityRate?: (v: number) => void;
}) {
  const { unit, factor } = useDisplay();
  const [sample, setSample] = useState(100_000_000);
  const rows = useMemo(() => sampleComparison(tiers, config, sample), [tiers, config, sample]);

  const eligible = rows.filter((r) => r.eligible && r.loan > 0);
  const bestLoan = Math.max(0, ...eligible.map((r) => r.loan));
  const bestPmt = eligible.length ? Math.min(...eligible.map((r) => r.pmt)) : 0;
  const costs = eligible.map((r) => r.customerCost).filter((c): c is number => c !== null);
  const bestCost = costs.length ? Math.min(...costs) : null;
  const bestRoi = Math.max(0, ...eligible.map((r) => r.roi));

  const th = 'px-3 py-2.5 text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap';
  const td = 'px-3 py-2.5 whitespace-nowrap border-b border-slate-100 dark:border-slate-800';
  const crown = <Crown className="inline h-3.5 w-3.5 text-amber-500" />;

  return (
    <Card>
      <CardHeader
        icon={<Calculator />}
        title="جدول مقایسه پله‌ها برای سپرده نمونه"
        subtitle="مبلغ وام، قسط ماهانه، کل کارمزد/سود، نرخ بازگشت سرمایه و نرخ مؤثر سالانه به ازای یک سپرده‌گذار نمونه"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onOpportunityRate && (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                هزینه فرصت:
                <NumField
                  size="sm"
                  value={config.opportunityRate}
                  onChange={onOpportunityRate}
                  min={0}
                  max={100}
                  step={0.5}
                  decimals={1}
                  suffix="٪"
                  className="w-[104px]"
                  ariaLabel="نرخ هزینه فرصت سپرده"
                />
              </span>
            )}
            <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">سپرده نمونه:</span>
            <NumField money size="sm" value={sample} min={0} onChange={setSample} suffix={unit} className="w-[190px]" />
            <div className="flex gap-1">
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSample(s)}
                  className={cn(
                    'rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 transition',
                    sample === s
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:ring-indigo-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
                  )}
                >
                  {fmtCompact(s * factor)}
                </button>
              ))}
            </div>
          </div>
        }
      />
      <div className="alm-scroll overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[12.5px]">
          <thead className="bg-slate-50 dark:bg-slate-950/40">
            <tr>
              <th className={th}>پله</th>
              <th className={th}>شرایط</th>
              <th className={th}>مبلغ وام</th>
              <th className={th}>قسط ماهانه</th>
              <th className={th}>کل بازپرداخت</th>
              <th className={th}>کل کارمزد / سود</th>
              <th className={th}>نرخ بازگشت سرمایه (ROI)</th>
              <th className={th}>نرخ مؤثر سالانه (IRR)</th>
              <th className={th}>هزینه واقعی مشتری*</th>
              <th className={th}>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  پله‌ای برای مقایسه وجود ندارد.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isBestLoan = r.eligible && r.loan > 0 && Math.abs(r.loan - bestLoan) < 1;
              const isBestPmt = r.eligible && r.loan > 0 && Math.abs(r.pmt - bestPmt) < 1;
              const isBestCost = r.customerCost !== null && bestCost !== null && Math.abs(r.customerCost - bestCost) < 1e-6;
              const isBestRoi = r.eligible && r.loan > 0 && Math.abs(r.roi - bestRoi) < 1e-9 && bestRoi > 0;
              return (
                <tr key={r.tier.id} className={cn('hover:bg-slate-50/70 dark:hover:bg-slate-800/30', !r.eligible && 'opacity-60')}>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[10.5px] font-bold text-white"
                        style={{ background: tierColor(r.index) }}
                      >
                        {toFa(r.index + 1)}
                      </span>
                      <span className="max-w-[170px] truncate font-semibold text-slate-700 dark:text-slate-200">{r.tier.name}</span>
                    </div>
                  </td>
                  <td className={cn(td, 'text-[11.5px] text-slate-500 dark:text-slate-400')}>
                    انتظار {toFa(r.tier.tDep)} · {toFa(r.tier.tLoan)} قسط · α {fmtPct(r.tier.alpha, 0)} · نرخ {fmtPct(r.rate, 1)}
                  </td>
                  <td className={td}>
                    <div className="flex flex-col gap-1">
                      <span className={cn('font-bold', isBestLoan && 'text-emerald-600 dark:text-emerald-400')}>
                        <Money value={r.loan} /> {isBestLoan && crown}
                      </span>
                      <div className="h-1 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${bestLoan > 0 ? (r.loan / bestLoan) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={cn(td, 'font-semibold', isBestPmt && 'text-emerald-600 dark:text-emerald-400')}>
                    <Money value={r.pmt} /> {isBestPmt && crown}
                  </td>
                  <td className={td}>
                    <Money value={r.totalRepay} />
                  </td>
                  <td className={cn(td, 'font-semibold text-indigo-600 dark:text-indigo-300')}>
                    <Money value={r.totalFee} />
                  </td>
                  <td className={cn(td, 'font-semibold', isBestRoi && 'text-emerald-600 dark:text-emerald-400')}>
                    {fmtPct(r.roi * 100, 2)} {isBestRoi && crown}
                  </td>
                  <td className={td}>{r.apr === null ? '—' : fmtPct(r.apr * 100, 2)}</td>
                  <td className={cn(td, 'font-semibold', isBestCost && 'text-emerald-600 dark:text-emerald-400')}>
                    {r.customerCost === null ? (
                      <span className="text-rose-500">نامعقول</span>
                    ) : (
                      <>
                        {fmtPct(r.customerCost * 100, 2)} {isBestCost && crown}
                      </>
                    )}
                  </td>
                  <td className={td}>
                    {!r.eligible ? (
                      <Badge tone="rose">زیر حداقل مانده</Badge>
                    ) : r.capped ? (
                      <Badge tone="amber">مشمول سقف فردی</Badge>
                    ) : (
                      <Badge tone="emerald">واجد شرایط</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-slate-100 px-5 py-3 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <p>
          <b>ROI</b> = کل کارمزد یا سود ÷ مبلغ وام · <b>IRR</b> = نرخ مؤثر سالانه جریان (+L ، −PMT × T) ·{' '}
          <b>مبلغ وام</b> = min(سپرده نمونه × α ، سقف فردی {config.loanCap > 0 ? <Money value={config.loanCap} unit /> : 'نامحدود'})
        </p>
        <p>
          * هزینه واقعی مشتری: IRR پس از کسر هزینه فرصت سپرده در دوره انتظار با نرخ {fmtPct(config.opportunityRate)} سالانه؛
          «نامعقول» یعنی هزینه فرصت از مبلغ وام بیشتر است.
        </p>
      </div>
    </Card>
  );
}

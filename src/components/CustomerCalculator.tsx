import { useMemo, useState } from 'react';
import { Calculator, CircleAlert, CircleCheck, Clock3, Coins, Wallet } from 'lucide-react';
import type { GlobalConfig, Tier } from '../types';
import { estimateTierOffer } from '../lib/engine';
import { fmtCompact, fmtPct, toFa } from '../lib/format';
import { tierLabel } from '../lib/presets';
import { TIER_WAIT_MAX, TIER_WAIT_MIN } from '../lib/limits';
import { useDisplay } from '../context/display';
import { Badge, Card, CardHeader, Field, Money, NumField } from './ui';
import { cn } from '../utils/cn';

interface Props {
  tiers: Tier[];
  config: GlobalConfig;
}

const selectClass =
  'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100 dark:focus:border-indigo-500';

const QUICK_AMOUNTS = [50_000_000, 100_000_000, 200_000_000];

export function CustomerCalculator({ tiers, config }: Props) {
  const { factor, unit } = useDisplay();
  const [depositBalance, setDepositBalance] = useState(100_000_000);
  const [waitingMonths, setWaitingMonths] = useState(4);
  const [repaymentMonths, setRepaymentMonths] = useState(12);
  const [selectedTierId, setSelectedTierId] = useState('');

  const waitingOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tiers
            .map((tier) => Math.round(tier.tDep))
            .filter((months) => Number.isFinite(months) && months >= TIER_WAIT_MIN && months <= TIER_WAIT_MAX),
        ),
      ).sort((a, b) => a - b),
    [tiers],
  );
  const selectedWaiting = waitingOptions.includes(waitingMonths)
    ? waitingMonths
    : waitingOptions.includes(4)
      ? 4
      : (waitingOptions[0] ?? null);

  const repaymentOptions = useMemo(
    () =>
      selectedWaiting === null
        ? []
        : Array.from(
            new Set(
              tiers
                .filter((tier) => Math.round(tier.tDep) === selectedWaiting)
                .map((tier) => Math.round(tier.tLoan))
                .filter((months) => Number.isFinite(months) && months >= 6 && months <= 60),
            ),
          ).sort((a, b) => a - b),
    [tiers, selectedWaiting],
  );
  const selectedRepayment = repaymentOptions.includes(repaymentMonths)
    ? repaymentMonths
    : repaymentOptions.includes(12)
      ? 12
      : (repaymentOptions[0] ?? null);

  const matchingTiers = useMemo(
    () =>
      selectedWaiting === null || selectedRepayment === null
        ? []
        : tiers
            .map((tier, index) => ({ tier, index }))
            .filter(
              ({ tier }) =>
                Math.round(tier.tDep) === selectedWaiting && Math.round(tier.tLoan) === selectedRepayment,
            ),
    [tiers, selectedWaiting, selectedRepayment],
  );
  const matchingWithLabels = matchingTiers.map((item) => ({
    ...item,
    label: tierLabel(item.index),
  }));
  const selected = matchingWithLabels.find(({ tier }) => tier.id === selectedTierId) ?? matchingWithLabels[0] ?? null;
  const estimate = selected ? estimateTierOffer(selected.tier, config, depositBalance) : null;

  const contractLabel = config.contractType === 'qard' ? 'قرض‌الحسنه' : 'مرابحه';
  const rateLabel = config.contractType === 'qard' ? 'کارمزد سالانه' : 'سود سالانه';

  return (
    <Card>
      <CardHeader
        icon={<Calculator />}
        title="برآورد مبلغ تسهیلات و قسط مشتری"
        subtitle="مبلغ سپرده و شرایط دلخواه را انتخاب کنید؛ نتیجه با ضریب، حداقل مانده، سقف و نرخ فعال محصول محاسبه می‌شود."
        actions={
          <Badge tone="indigo">
            <Clock3 />
            به‌روزرسانی لحظه‌ای
          </Badge>
        }
      />

      <div className="grid gap-4 p-5 md:grid-cols-3">
        <Field
          label="میانگین مانده سپرده"
          info="مبنای محاسبه، میانگین ماندهٔ مشتری در دورهٔ انتظار است. اگر موجودی در طول دوره تغییر کرده، میانگین واقعی را وارد کنید."
          hint="مبلغ به واحد انتخاب‌شده در سربرگ نمایش داده می‌شود."
        >
          <NumField
            money
            value={depositBalance}
            onChange={setDepositBalance}
            min={0}
            max={1e16}
            suffix={unit}
            ariaLabel="میانگین مانده سپرده مشتری"
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setDepositBalance(amount)}
                className={cn(
                  'rounded-lg px-2 py-1 text-[10.5px] font-semibold ring-1 transition',
                  depositBalance === amount
                    ? 'bg-indigo-600 text-white ring-indigo-600'
                    : 'bg-white text-slate-500 ring-slate-200 hover:border-indigo-300 hover:text-indigo-600 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
                )}
              >
                {fmtCompact(amount * factor)} {unit}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="مدت خواب سپرده"
          info="فقط دوره‌های انتظاری که در پله‌های محصول تعریف شده‌اند قابل انتخاب هستند."
          hint="مدت انتخابی باید دقیقاً با یک حالت محصول منطبق باشد."
        >
          <select
            aria-label="مدت خواب سپرده"
            className={selectClass}
            value={selectedWaiting === null ? '' : String(selectedWaiting)}
            disabled={waitingOptions.length === 0}
            onChange={(event) => setWaitingMonths(Number(event.target.value))}
          >
            {waitingOptions.length === 0 ? (
              <option value="">حالت تعریف نشده</option>
            ) : (
              waitingOptions.map((months) => (
                <option key={months} value={months}>
                  {toFa(months)} ماه
                </option>
              ))
            )}
          </select>
        </Field>

        <Field
          label="دوره بازپرداخت"
          info="مدت‌های قابل انتخاب بر اساس پله‌های موجود برای دوره انتظار انتخاب‌شده نمایش داده می‌شوند."
          hint="تعداد اقساط ماهانه"
        >
          <select
            aria-label="دوره بازپرداخت"
            className={selectClass}
            value={selectedRepayment === null ? '' : String(selectedRepayment)}
            disabled={repaymentOptions.length === 0}
            onChange={(event) => setRepaymentMonths(Number(event.target.value))}
          >
            {repaymentOptions.length === 0 ? (
              <option value="">دوره‌ای در دسترس نیست</option>
            ) : (
              repaymentOptions.map((months) => (
                <option key={months} value={months}>
                  {toFa(months)} قسط
                </option>
              ))
            )}
          </select>
        </Field>

        {matchingWithLabels.length > 1 && (
          <Field label="حالت محصول" className="md:col-span-3">
            <select
              aria-label="حالت محصول"
              className={selectClass}
              value={selected?.tier.id ?? ''}
              onChange={(event) => setSelectedTierId(event.target.value)}
            >
              {matchingWithLabels.map(({ tier, label }) => (
                <option key={tier.id} value={tier.id}>
                  {label} · ضریب {fmtPct(tier.alpha, 2)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="border-t border-slate-100 p-5 dark:border-slate-800">
        {!selected || !estimate ? (
          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-7 text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300">
            <CircleAlert className="mt-1 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              {tiers.length === 0
                ? 'برای برآورد تسهیلات، ابتدا در بخش ۲ دست‌کم یک حالت محصول تعریف کنید.'
                : 'برای شرایط انتخاب‌شده حالت قابل محاسبه‌ای وجود ندارد. دوره انتظار یا بازپرداخت دیگری را انتخاب کنید.'}
            </div>
          </div>
        ) : !estimate.eligible ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm leading-7 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            <CircleAlert className="mt-1 h-5 w-5 shrink-0" />
            <div>
              {estimate.belowMinimumLoan ? (
                <>
                  مبلغ خام این حالت <Money value={estimate.rawLoan} unit /> است و به حداقل مبلغ تسهیلات محصول،{' '}
                  <b><Money value={estimate.minimumLoan} unit /></b>، نمی‌رسد؛ بنابراین فعلاً برای این میانگین سپرده تسهیلاتی برآورد نمی‌شود.
                </>
              ) : depositBalance <= 0 ? (
                <>
                  مبلغ سپرده را وارد کنید تا برآورد انجام شود. حداقل میانگین مانده برای {selected.label}{' '}
                  <Money value={selected.tier.minBalance} unit /> است.
                </>
              ) : (
                <>
                  میانگین مانده واردشده به حداقل این حالت نمی‌رسد. حداقل موردنیاز{' '}
                  <b><Money value={selected.tier.minBalance} unit /></b> است؛ بنابراین فعلاً تسهیلاتی برای این حالت برآورد نمی‌شود.
                </>
              )}
            </div>
          </div>
        ) : estimate.loan <= 0 ? (
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300">
            <CircleAlert className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
            <div>ضریب تسهیلات این حالت صفر است؛ برای برآورد مبلغ و قسط، ضریب آن را در سازندهٔ پله‌ها افزایش دهید.</div>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.85fr)]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-slate-700 dark:text-slate-200">
                  <span>نتیجه بر اساس</span>
                  <Badge tone="indigo">{selected.label}</Badge>
                  <span className="text-slate-400">·</span>
                  <span>{toFa(selectedWaiting ?? 0)} ماه خواب</span>
                  <span className="text-slate-400">·</span>
                  <span>{toFa(selectedRepayment ?? 0)} قسط</span>
                </div>
                <Badge tone="emerald">
                  <CircleCheck />
                  واجد حداقل شرایط
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-linear-to-br from-indigo-600 to-violet-700 p-4 text-white shadow-lg shadow-indigo-600/15">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-indigo-100">
                    <Wallet className="h-4 w-4" />
                    مبلغ تسهیلات برآوردی
                  </div>
                  <div className="mt-3 text-[24px] font-black leading-9 tabular-nums sm:text-[28px]">
                    <Money value={estimate.loan} unit />
                  </div>
                  <div className="mt-1 text-[11px] text-indigo-100">پس از اعمال سقف فردی و حداقل مانده</div>
                </div>

                <div className="rounded-2xl bg-linear-to-br from-emerald-500 to-teal-600 p-4 text-white shadow-lg shadow-emerald-600/15">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-50">
                    <Coins className="h-4 w-4" />
                    قسط ماهانهٔ تقریبی
                  </div>
                  <div className="mt-3 text-[24px] font-black leading-9 tabular-nums sm:text-[28px]">
                    <Money value={estimate.monthlyPayment} unit />
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-50">به مدت {toFa(selectedRepayment ?? 0)} ماه</div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">جمع بازپرداخت</div>
                  <div className="mt-1.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-100">
                    <Money value={estimate.totalRepayment} unit />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">جمع {config.contractType === 'qard' ? 'کارمزد' : 'سود'} اقساط</div>
                  <div className="mt-1.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-100">
                    <Money value={estimate.totalCharge} unit />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">{rateLabel}</div>
                  <div className="mt-1.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-100">{fmtPct(estimate.rate, 2)}</div>
                </div>
              </div>

              {estimate.capped && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11.5px] leading-6 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  <Badge tone="amber">سقف فردی اعمال شد</Badge>
                  <span>
                    مبلغ خام از سقف بیشتر است؛ برآورد تا <Money value={config.loanCap} unit /> محدود شده است.
                  </span>
                </div>
              )}
            </div>

            <aside className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
              <div className="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">جزئیات محاسبه</div>
              <div className="mt-3 space-y-2.5 text-[11.5px] leading-6 text-slate-600 dark:text-slate-300">
                <div className="flex items-start justify-between gap-3">
                  <span>ضریب این حالت</span>
                  <b className="shrink-0 text-slate-800 dark:text-slate-100">{fmtPct(selected.tier.alpha, 2)}</b>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span>{rateLabel}</span>
                  <b className="shrink-0 text-slate-800 dark:text-slate-100">{fmtPct(estimate.rate, 2)}</b>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span>سقف فردی</span>
                  <b className="shrink-0 text-left text-slate-800 dark:text-slate-100">
                    {config.loanCap > 0 ? <Money value={config.loanCap} unit /> : 'بدون سقف'}
                  </b>
                </div>
                <div className="border-t border-indigo-200/70 pt-2.5 dark:border-indigo-500/20">
                  مبلغ خام = میانگین مانده × ضریب حالت؛ سپس سقف فردی اعمال می‌شود. قسط بر اساس عقد {contractLabel} و نرخ فعال محاسبه شده است.
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-[10.5px] leading-6 text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-400">
        این عدد یک برآورد اولیه بر مبنای میانگین ثابت سپرده، شرایط همین محصول و نرخ‌های واردشده است؛ تأیید اعتبار، هزینه‌های جانبی و ضوابط اجرایی می‌توانند نتیجهٔ نهایی را تغییر دهند.
      </div>
    </Card>
  );
}

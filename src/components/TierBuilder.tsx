import { ArrowDown, ArrowUp, Copy, Layers, Plus, Scale, Sparkles, Trash, TriangleAlert } from 'lucide-react';
import type { GlobalConfig, Tier, TierResult } from '../types';
import { FARAPOUYA, FARAPOUYA_ALPHA_STEPS, FARAPOUYA_RATE_STEPS, PRESETS, tierColor, tierLabel, uid } from '../lib/presets';
import { IMPORT_MONEY_MAX, TIER_ALPHA_MAX, TIER_ALPHA_MIN, TIER_WAIT_MAX, TIER_WAIT_MIN } from '../lib/limits';
import { globalRate } from '../lib/engine';
import { fmtNumber, fmtPct, fmtRaw, toFa } from '../lib/format';
import { useDisplay } from '../context/display';
import { Badge, Button, Card, CardHeader, InfoTip, NumField } from './ui';
import { cn } from '../utils/cn';

interface Props {
  tiers: Tier[];
  results: TierResult[];
  config: GlobalConfig;
  activePreset: string | null;
  onChange: (tiers: Tier[]) => void;
  onLoadPreset: (key: string) => void;
}

export function TierBuilder({ tiers, results, config, activePreset, onChange, onLoadPreset }: Props) {
  const { unit } = useDisplay();
  const allocSum = tiers.reduce((s, t) => s + Math.max(0, t.allocation || 0), 0);
  const allocOk = Math.abs(allocSum - 100) < 0.05;
  const activePresetDetails = PRESETS.find((preset) => preset.key === activePreset);
  const activeRate = config.contractType === 'qard' ? config.qardFeeRate : config.murabahaRate;
  const activeAlphaRange = activePresetDetails?.rateAlphaRanges?.[activeRate] ?? activePresetDetails?.alphaRange;
  const waitMin = activePresetDetails?.waitingRange?.[0] ?? TIER_WAIT_MIN;
  const waitMax = activePresetDetails?.waitingRange?.[1] ?? TIER_WAIT_MAX;
  const repaymentMin = activePresetDetails?.repaymentTerms
    ? Math.min(...activePresetDetails.repaymentTerms)
    : 6;
  const repaymentMax = activePresetDetails?.repaymentTerms
    ? Math.max(...activePresetDetails.repaymentTerms)
    : 60;
  const alphaMin = activeAlphaRange?.[0] ?? TIER_ALPHA_MIN;
  const alphaMax = activeAlphaRange?.[1] ?? TIER_ALPHA_MAX;
  const rateMin = activePresetDetails?.tierRateRange?.[0] ?? 0;
  const rateMax = activePresetDetails?.tierRateRange?.[1] ?? (activePresetDetails?.rateOptions?.at(-1) ?? 60);
  const gRate = globalRate(config);
  const resultById = new Map(results.map((r) => [r.tier.id, r]));

  /* ماتریس حالت‌های نگین فراپویا: دامنه‌های بازسازی‌شده از خودِ الگو خوانده
     می‌شوند تا متن توضیحی هرگز از حالت‌های واقعی جدا نیفتد. */
  const farapouyaPreset = activePreset === 'sample-3' ? activePresetDetails : undefined;
  const farapouya = (() => {
    if (!farapouyaPreset) return null;
    const presetModes = farapouyaPreset.tiers;
    const rates = presetModes.map((tier) => tier.rateOverride ?? farapouyaPreset.rate);
    const alphas = presetModes.map((tier) => tier.alpha);
    const bothSteps = FARAPOUYA_RATE_STEPS + FARAPOUYA_ALPHA_STEPS;
    return {
      modes: presetModes.length,
      waitings: new Set(presetModes.map((tier) => tier.tDep)).size,
      alphaMin: Math.min(...alphas),
      alphaMax: Math.max(...alphas),
      rateMin: Math.min(...rates),
      rateMax: Math.max(...rates),
      rateSteps: FARAPOUYA_RATE_STEPS,
      alphaSteps: FARAPOUYA_ALPHA_STEPS,
      // امتیاز و انتظارِ لازم برای رسیدنِ هم‌زمان به هر دو کران منتشرشده
      bothSteps,
      bothWait: FARAPOUYA.minWait + bothSteps,
    };
  })();

  const update = (id: string, patch: Partial<Tier>) =>
    onChange(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const remove = (id: string) => onChange(tiers.filter((t) => t.id !== id));

  const duplicate = (id: string) => {
    const idx = tiers.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const copy: Tier = { ...tiers[idx], id: uid(), name: tierLabel(idx + 1) };
    const next = [...tiers];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= tiers.length) return;
    const next = [...tiers];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const add = () => {
    const remaining = Math.max(0, 100 - allocSum);
    onChange([
      ...tiers,
      {
        id: uid(),
        name: tierLabel(tiers.length),
        tDep: 6,
        tLoan: 24,
        alpha: 100,
        minBalance: 10_000_000,
        allocation: remaining > 0.05 ? Math.round(remaining * 10) / 10 : 10,
        rateOverride: null,
      },
    ]);
  };

  const normalize = () => {
    if (allocSum <= 0) return;
    const next = tiers.map((t) => ({
      ...t,
      allocation: Math.round((Math.max(0, t.allocation) / allocSum) * 1000) / 10,
    }));
    const diff = Math.round((100 - next.reduce((s, t) => s + t.allocation, 0)) * 10) / 10;
    const lastIdx = next.map((t) => t.allocation > 0).lastIndexOf(true);
    if (lastIdx >= 0 && diff !== 0)
      next[lastIdx].allocation = Math.max(0, Math.round((next[lastIdx].allocation + diff) * 10) / 10);
    onChange(next);
  };

  const wAvg = (f: (t: Tier) => number) =>
    allocSum > 0 ? tiers.reduce((s, t) => s + f(t) * Math.max(0, t.allocation), 0) / allocSum : 0;

  const th = 'px-2 py-2.5 text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap';

  return (
    <Card>
      <CardHeader
        icon={<Layers />}
        title="مدیریت پویا و سازنده پله‌های محصول"
        subtitle="تعریف بی‌نهایت پله با ویرایش درون‌جدولی؛ هر تغییر بلافاصله کل ماتریس نقدینگی را بازمحاسبه می‌کند"
        actions={
          <Button variant="primary" size="sm" onClick={add}>
            <Plus />
            افزودن حالت جدید
          </Button>
        }
      />

      {/* Presets */}
      <div className="grid gap-3 p-5 pb-2 md:grid-cols-2">
        {PRESETS.map((p) => {
          const active = activePreset === p.key;
          const displayedRate = active ? (p.contractType === 'qard' ? config.qardFeeRate : config.murabahaRate) : p.rate;
          const displayedAlphaRange = p.rateAlphaRanges?.[displayedRate] ?? p.alphaRange;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onLoadPreset(p.key)}
              className={cn(
                'group relative overflow-hidden rounded-xl border p-3.5 text-right transition',
                active
                  ? 'border-indigo-400 bg-indigo-50/70 ring-4 ring-indigo-500/10 dark:border-indigo-500/60 dark:bg-indigo-500/10'
                  : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-indigo-500/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[14px] font-extrabold text-slate-800 dark:text-slate-100">
                  <Sparkles className={cn('h-4 w-4', active ? 'text-indigo-500' : 'text-slate-400 group-hover:text-indigo-400')} />
                  {p.name}
                </span>
                <Badge tone={active ? 'indigo' : 'slate'}>الگوی قابل ویرایش</Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{p.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={p.contractType === 'qard' ? 'emerald' : 'amber'}>
                  {p.contractType === 'qard' ? 'قرض‌الحسنه' : 'مرابحه'} {fmtPct(displayedRate, 1)}
                </Badge>
                <Badge>{toFa(p.tiers.length)} حالت</Badge>
                <Badge>سقف فردی {fmtNumber(p.loanCap / 1e6)} میلیون</Badge>
                {p.programCap && <Badge>سقف گزارش‌شدهٔ طرح {fmtNumber(p.programCap / 1e6)} میلیون</Badge>}
                {p.waitingRange && (
                  <Badge>
                    انتظار {toFa(p.waitingRange[0])}–{toFa(p.waitingRange[1])} ماه
                  </Badge>
                )}
                {p.repaymentTerms && (
                  <Badge>اقساط {p.repaymentTerms.map((months) => toFa(months)).join('، ')}</Badge>
                )}
                {displayedAlphaRange && (
                  <Badge>
                    ضریب {fmtPct(displayedAlphaRange[0], 2)}–{fmtPct(displayedAlphaRange[1], 2)}
                  </Badge>
                )}
                {p.tierRateRange && (
                  <Badge>
                    نرخ پله {fmtPct(p.tierRateRange[0], 1)}–{fmtPct(p.tierRateRange[1], 1)}
                  </Badge>
                )}
                {p.rateOptions && (
                  <Badge>کارمزد {p.rateOptions.map((rate) => fmtPct(rate, 0)).join(' / ')}</Badge>
                )}
                {active && <Badge tone="indigo">فعال</Badge>}
              </div>
            </button>
          );
        })}
      </div>

      {activePreset === 'sample-1' && (
        <div className="mx-5 mt-3 rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-[11.5px] leading-6 text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/5 dark:text-sky-100">
          <div className="font-extrabold">ماتریس حالت‌های نگین امید زرین</div>
          <div>
            ۱۸ دورهٔ انتظار × ۵ دورهٔ بازپرداخت = ۹۰ حالت. ضریب این الگو از دامنه‌های منتشرشده بازسازی شده است:{' '}
            <span dir="ltr" className="font-mono">α(٪) = k × T_dep / T_loan</span>؛ مقدار <b>k</b> برای کارمزد ۰/۲/۴٪ به‌ترتیب
            ۱۵۰/۲۰۰/۲۴۰ است.
          </div>
          <div className="text-sky-800 dark:text-sky-200">
            سهم آغازین هر حالت {fmtPct(100 / Math.max(1, tiers.length), 2)} است تا موتور بتواند سبد را اجرا کند؛ چون ترکیب واقعی
            مشتریان منتشر نشده، این سهم صرفاً فرض آموزشی و قابل‌ویرایش است، نه سهم رسمی بانک.
          </div>
        </div>
      )}

      {farapouya && (
        <div className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[11.5px] leading-6 text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-100">
          <div className="font-extrabold">ماتریس حالت‌های نگین فراپویا (بانک سپه)</div>
          <div>
            {toFa(farapouya.waitings)} دورهٔ انتظار ({toFa(FARAPOUYA.minWait)} تا {toFa(FARAPOUYA.maxWait)} ماه) ×{' '}
            {toFa(FARAPOUYA.terms.length)} دورهٔ بازپرداخت ({toFa(FARAPOUYA.terms[0])} تا {toFa(FARAPOUYA.maxTerm)} ماه) ={' '}
            {toFa(farapouya.modes)} حالتِ مجاز. قاعدهٔ محصول: هر ماه انتظارِ بیشتر از حداقلِ {toFa(FARAPOUYA.minWait)} ماه یک
            امتیاز می‌سازد که صرفِ یکی از سه مزیت (یا ترکیبی از آن‌ها) می‌شود — {toFa(FARAPOUYA.termStep)}+ ماه اقساط تا سقف{' '}
            {toFa(FARAPOUYA.maxTerm)}، یا {toFa(FARAPOUYA.alphaStep)}+ واحد درصد ضریب تا سقف {toFa(FARAPOUYA.alphaCap)}٪، یا{' '}
            {toFa(FARAPOUYA.rateStep)}− واحد درصد نرخ سود تا کف {toFa(FARAPOUYA.rateFloor)}٪. اقساط بالاتر از{' '}
            {toFa(FARAPOUYA.baseTerm)} ماه فقط با انتظارِ بیش از {toFa(FARAPOUYA.minWait)} ماه ممکن است.
          </div>
          <div>
            موتور امتیاز باقی‌ماندهٔ هر حالت را به نسبت هزینهٔ کاملِ دو مزیت ({toFa(farapouya.rateSteps)} گام برای نرخ و{' '}
            {toFa(farapouya.alphaSteps)} گام برای ضریب) تقسیم می‌کند؛ نتیجه ضریب {fmtPct(farapouya.alphaMin, 0)} تا{' '}
            {fmtPct(farapouya.alphaMax, 0)} و نرخ {fmtPct(farapouya.rateMin, 0)} تا {fmtPct(farapouya.rateMax, 0)} است. رسیدنِ
            هم‌زمان به ضریب {fmtPct(FARAPOUYA.alphaCap, 0)} و نرخ {fmtPct(FARAPOUYA.rateFloor, 0)} به {toFa(farapouya.bothSteps)}{' '}
            امتیاز ({toFa(farapouya.bothWait)} ماه انتظار) نیاز دارد و با سقفِ {toFa(FARAPOUYA.maxWait)} ماهِ محصول ممکن نیست.
            جدول رسمی حالت‌ها از بانک منتشر نشده، پس این بازسازی شفاف است و هر دو فیلد قابل‌ویرایش‌اند.
          </div>
          <div className="text-amber-800 dark:text-amber-200">
            سهم آغازین هر حالت {fmtPct(100 / Math.max(1, tiers.length), 2)} است (فرض آموزشی، نه ترکیب رسمی مشتریان). حداقل
            میانگین مانده {fmtNumber(FARAPOUYA.minBalance / 1e6)} میلیون تومان، حداقل مبلغ تسهیلات{' '}
            {fmtNumber(FARAPOUYA.minLoan / 1e6)} میلیون تومان، سقف فردی {fmtNumber(FARAPOUYA.loanCap / 1e6)} میلیون تومان و نرخ
            سود علی‌الحساب خودِ سپرده {fmtPct(FARAPOUYA.depositProfitRate, 2)} است.
          </div>
        </div>
      )}

      {/* Table */}
      <div className="alm-scroll overflow-x-auto px-5 pb-3 pt-3">
        <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/40">
              <th className={cn(th, 'rounded-r-lg')}>عنوان حالت</th>
              <th className={th}>
                دوره انتظار <span className="font-mono text-[10px] font-medium text-slate-400">T_dep</span>
              </th>
              <th className={th}>
                دوره بازپرداخت <span className="font-mono text-[10px] font-medium text-slate-400">T_loan</span>
              </th>
              <th className={th}>
                ضریب برابری <span className="font-mono text-[10px] font-medium text-slate-400">α</span>
              </th>
              <th className={th}>حداقل میانگین مانده ({unit})</th>
              <th className={th}>سهم تخصیص</th>
              <th className={th}>
                <span className="inline-flex items-center gap-1">
                  نرخ اختصاصی
                  <InfoTip text="نرخ اختصاصی این حالت را مستقیم ویرایش کنید؛ خالی‌کردن فیلد، نرخ ثبت‌شده را پاک نمی‌کند." />
                </span>
              </th>
              <th className={th}>
                <span className="inline-flex items-center gap-1">
                  ضریب مؤثر
                  <InfoTip text="α_eff = min(α ، سقف فردی ÷ مانده مبنا) — مانده مبنا = بیشینه میانگین سپرده مشتری و حداقل مانده پله" />
                </span>
              </th>
              <th className={th}>چرخه عمر</th>
              <th className={cn(th, 'rounded-l-lg text-center')}>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {tiers.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-slate-400">
                  هیچ حالتی تعریف نشده است. یک نمونه طرح انتخاب کنید یا «افزودن حالت جدید» را بزنید.
                </td>
              </tr>
            )}
            {tiers.map((t, i) => {
              const r = resultById.get(t.id);
              const effShare = allocSum > 0 ? (Math.max(0, t.allocation) / allocSum) * 100 : 0;
              return (
                <tr key={t.id} className="group transition hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex min-w-[135px] items-center gap-2">
                      <span
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm"
                        style={{ background: tierColor(i) }}
                      >
                        {toFa(i + 1)}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{tierLabel(i)}</span>
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <NumField
                      size="sm"
                      value={t.tDep}
                      min={waitMin}
                      max={waitMax}
                      onChange={(v) => update(t.id, { tDep: Math.round(v) })}
                      suffix="ماه"
                      className="w-[92px]"
                      ariaLabel="دوره انتظار"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex flex-col items-start gap-1">
                      {activePresetDetails?.repaymentTerms ? (
                        <select
                          value={String(t.tLoan)}
                          onChange={(event) => update(t.id, { tLoan: Number(event.target.value) })}
                          aria-label={`دوره بازپرداخت ${tierLabel(i)}`}
                          className="h-8 w-[92px] rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200"
                        >
                          {activePresetDetails.repaymentTerms.map((months) => (
                            <option key={months} value={months}>
                              {toFa(months)} ماه
                            </option>
                          ))}
                        </select>
                      ) : (
                        <NumField
                          size="sm"
                          value={t.tLoan}
                          min={repaymentMin}
                          max={repaymentMax}
                          onChange={(v) => update(t.id, { tLoan: Math.round(v) })}
                          suffix="ماه"
                          className="w-[92px]"
                          ariaLabel="دوره بازپرداخت"
                        />
                      )}
                      {activePresetDetails?.modeFeasible?.(t.tDep, t.tLoan) === false && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400"
                          title={activePresetDetails.modeRule}
                        >
                          <TriangleAlert className="h-3 w-3" />
                          خارج از قاعدهٔ محصول
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <NumField
                      size="sm"
                      value={t.alpha}
                      min={alphaMin}
                      max={alphaMax}
                      step={0.1}
                      decimals={2}
                      onChange={(v) => update(t.id, { alpha: v })}
                      suffix="٪"
                      className="w-[92px]"
                      ariaLabel="ضریب برابری"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <NumField
                      size="sm"
                      money
                      value={t.minBalance}
                      min={0}
                      max={IMPORT_MONEY_MAX}
                      onChange={(v) => update(t.id, { minBalance: v })}
                      className="w-[140px]"
                      ariaLabel="حداقل میانگین مانده"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex flex-col gap-1">
                      <NumField
                        size="sm"
                        value={t.allocation}
                        min={0}
                        max={100}
                        decimals={1}
                        onChange={(v) => update(t.id, { allocation: v })}
                        suffix="٪"
                        className="w-[92px]"
                        ariaLabel="سهم تخصیص"
                      />
                      <div className="h-1 w-[92px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, effShare)}%`, background: tierColor(i) }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    {activePresetDetails?.rateOptions ? (
                      <select
                        value={t.rateOverride === null ? '' : String(t.rateOverride)}
                        onChange={(event) =>
                          update(t.id, { rateOverride: event.target.value === '' ? null : Number(event.target.value) })
                        }
                        aria-label={`نرخ اختصاصی ${tierLabel(i)}`}
                        className="h-8 w-[112px] rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200"
                      >
                        <option value="">سراسری ({fmtPct(gRate, 0)})</option>
                        {activePresetDetails.rateOptions.map((rate) => (
                          <option key={rate} value={rate}>
                            {fmtPct(rate, 0)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <NumField
                        size="sm"
                        value={t.rateOverride}
                        placeholder={fmtRaw(gRate, 2)}
                        min={rateMin}
                        max={rateMax}
                        step={0.1}
                        decimals={2}
                        onChange={(v) => update(t.id, { rateOverride: v })}
                        suffix="٪"
                        className="w-[92px]"
                        ariaLabel={`نرخ اختصاصی ${tierLabel(i)}`}
                      />
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-bold text-slate-800 dark:text-slate-100">
                        {fmtPct((r?.alphaEff ?? t.alpha / 100) * 100, 2)}
                      </span>
                      {r?.capBinding ? (
                        <Badge tone="amber">
                          <Scale />
                          مشمول سقف
                        </Badge>
                      ) : (
                        <span className="text-[10.5px] text-slate-400">سهم مؤثر {fmtPct(effShare, 1)}</span>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex flex-col gap-1">
                      <span className="whitespace-nowrap font-semibold text-slate-700 dark:text-slate-200">
                        {toFa(t.tDep)} + {toFa(t.tLoan)} = {toFa(t.tDep + t.tLoan)} ماه
                      </span>
                      <div className="flex h-1.5 w-[110px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${(t.tDep / Math.max(1, t.tDep + t.tLoan)) * 100}%` }}
                          title="دوره انتظار"
                        />
                        <div className="h-full flex-1 bg-indigo-500" title="دوره بازپرداخت" />
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex items-center justify-center gap-0.5 opacity-70 transition group-hover:opacity-100">
                      <button
                        type="button"
                        title="انتقال به بالا"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="انتقال به پایین"
                        onClick={() => move(i, 1)}
                        disabled={i === tiers.length - 1}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="تکثیر پله"
                        onClick={() => duplicate(t.id)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="حذف پله"
                        onClick={() => remove(t.id)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold">مجموع تخصیص:</span>
          <Badge tone={allocOk ? 'emerald' : 'amber'}>{fmtPct(allocSum, 1)}</Badge>
          {!allocOk && tiers.length > 0 && (
            <>
              <span className="text-amber-600 dark:text-amber-400">سهم‌ها در محاسبات به‌طور خودکار نرمال‌سازی می‌شوند</span>
              <Button size="sm" variant="ghost" onClick={normalize}>
                نرمال‌سازی به ۱۰۰٪
              </Button>
            </>
          )}
          <span className="mx-1 hidden h-4 w-px bg-slate-200 dark:bg-slate-700 md:inline-block" />
          <span>
            میانگین وزنی: انتظار <b className="text-slate-700 dark:text-slate-200">{fmtNumber(wAvg((t) => t.tDep), 1)}</b> ماه ·
            بازپرداخت <b className="text-slate-700 dark:text-slate-200">{fmtNumber(wAvg((t) => t.tLoan), 1)}</b> ماه · ضریب{' '}
            <b className="text-slate-700 dark:text-slate-200">{fmtPct(wAvg((t) => t.alpha), 1)}</b>
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus />
          افزودن حالت
        </Button>
      </div>
    </Card>
  );
}

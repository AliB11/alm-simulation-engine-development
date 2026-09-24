import { ArrowDown, ArrowUp, Copy, Layers, Plus, Scale, Sparkles, Trash } from 'lucide-react';
import type { GlobalConfig, Tier, TierResult } from '../types';
import { PRESETS, tierColor, uid } from '../lib/presets';
import { TIER_ALPHA_MAX } from '../lib/limits';
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
  const gRate = globalRate(config);
  const resultById = new Map(results.map((r) => [r.tier.id, r]));

  const update = (id: string, patch: Partial<Tier>) =>
    onChange(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const remove = (id: string) => onChange(tiers.filter((t) => t.id !== id));

  const duplicate = (id: string) => {
    const idx = tiers.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const copy: Tier = { ...tiers[idx], id: uid(), name: `${tiers[idx].name} (کپی)` };
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
        name: `پله سفارشی ${toFa(tiers.length + 1)}`,
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
    if (lastIdx >= 0 && diff !== 0) next[lastIdx].allocation = Math.round((next[lastIdx].allocation + diff) * 10) / 10;
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
            افزودن پله جدید
          </Button>
        }
      />

      {/* Presets */}
      <div className="grid gap-3 p-5 pb-2 md:grid-cols-3">
        {PRESETS.map((p) => {
          const active = activePreset === p.key;
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
                <Badge tone={active ? 'indigo' : 'slate'}>{p.bank}</Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{p.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={p.contractType === 'qard' ? 'emerald' : 'amber'}>
                  {p.contractType === 'qard' ? 'قرض‌الحسنه' : 'مرابحه'} {fmtPct(p.rate, 1)}
                </Badge>
                <Badge>{toFa(p.tiers.length)} پله</Badge>
                <Badge>سقف {fmtNumber(p.loanCap / 1e6)} میلیون</Badge>
                {active && <Badge tone="indigo">فعال</Badge>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="alm-scroll overflow-x-auto px-5 pb-3 pt-3">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/40">
              <th className={cn(th, 'rounded-r-lg text-center')}>#</th>
              <th className={th}>نام / عنوان پله</th>
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
                  <InfoTip text="در صورت خالی بودن، نرخ سراسری کارمزد/سود استفاده می‌شود." />
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
                <td colSpan={11} className="py-10 text-center text-sm text-slate-400">
                  هیچ پله‌ای تعریف نشده است. یک پیش‌تنظیم انتخاب کنید یا «افزودن پله جدید» را بزنید.
                </td>
              </tr>
            )}
            {tiers.map((t, i) => {
              const r = resultById.get(t.id);
              const effShare = allocSum > 0 ? (Math.max(0, t.allocation) / allocSum) * 100 : 0;
              return (
                <tr key={t.id} className="group transition hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                  <td className="border-b border-slate-100 px-2 py-2 text-center dark:border-slate-800">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm"
                      style={{ background: tierColor(i) }}
                    >
                      {toFa(i + 1)}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <input
                      value={t.name}
                      onChange={(e) => update(t.id, { name: e.target.value })}
                      className="h-8 w-full min-w-[170px] rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <NumField
                      size="sm"
                      value={t.tDep}
                      min={1}
                      max={12}
                      onChange={(v) => update(t.id, { tDep: Math.round(v) })}
                      suffix="ماه"
                      className="w-[92px]"
                      ariaLabel="دوره انتظار"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <NumField
                      size="sm"
                      value={t.tLoan}
                      min={6}
                      max={60}
                      onChange={(v) => update(t.id, { tLoan: Math.round(v) })}
                      suffix="ماه"
                      className="w-[92px]"
                      ariaLabel="دوره بازپرداخت"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <NumField
                      size="sm"
                      value={t.alpha}
                      min={5}
                      max={TIER_ALPHA_MAX}
                      step={5}
                      decimals={1}
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
                    <NumField
                      size="sm"
                      value={t.rateOverride}
                      placeholder={fmtRaw(gRate, 2)}
                      min={0}
                      max={60}
                      decimals={2}
                      onChange={(v) => update(t.id, { rateOverride: v })}
                      onClear={() => update(t.id, { rateOverride: null })}
                      suffix="٪"
                      className="w-[92px]"
                      ariaLabel="نرخ اختصاصی"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 dark:border-slate-800">
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-bold text-slate-800 dark:text-slate-100">
                        {fmtPct((r?.alphaEff ?? t.alpha / 100) * 100, 1)}
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
          افزودن پله
        </Button>
      </div>
    </Card>
  );
}

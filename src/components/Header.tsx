import { useRef } from 'react';
import {
  Activity,
  Calculator,
  ChartArea,
  Download,
  FileBraces,
  FlaskConical,
  Landmark,
  Layers,
  Moon,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SquareFunction,
  Sun,
  TriangleAlert,
  Upload,
  Wallet,
} from 'lucide-react';
import type { Currency, SimKpis } from '../types';
import { fmtRatio, toFa } from '../lib/format';
import { IconButton, Money, Segmented } from './ui';
import { cn } from '../utils/cn';

const NAV = [
  { id: 'config', label: 'تنظیمات کلان', icon: Settings2 },
  { id: 'tiers', label: 'پله‌ها', icon: Layers },
  { id: 'commitments', label: 'منابع و تعهدات', icon: Wallet },
  { id: 'charts', label: 'نمودارهای ریسک', icon: ChartArea },
  { id: 'stress', label: 'آزمون حساسیت', icon: FlaskConical },
  { id: 'advanced', label: 'مونت‌کارلو و بهینه‌یاب', icon: Activity },
  { id: 'regulatory', label: 'سنجه‌های مقرراتی', icon: ShieldCheck },
  { id: 'customer-calculator', label: 'محاسبه‌گر مشتری', icon: Calculator },
  { id: 'method', label: 'روش‌شناسی', icon: SquareFunction },
];

interface HeaderProps {
  dark: boolean;
  onToggleDark: () => void;
  currency: Currency;
  onCurrency: (c: Currency) => void;
  onReset: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  kpis: SimKpis;
}

export function Header({
  dark,
  onToggleDark,
  currency,
  onCurrency,
  onReset,
  onExportCsv,
  onExportJson,
  onImportJson,
  kpis,
}: HeaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const safe = kpis.tippingPoint === null;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 via-indigo-600 to-violet-700 text-white shadow-lg shadow-indigo-500/30">
            <Landmark className="h-5 w-5" />
            <span className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-white dark:bg-slate-950 dark:ring-slate-950">
              <Activity className="h-3 w-3 text-emerald-500" />
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-extrabold leading-6 text-slate-900 dark:text-white sm:text-base">
              طراح سفارشی محصولات تسهیلاتی امتیازی و شبیه‌ساز ریسک نقدینگی
            </h1>
            <p dir="ltr" className="truncate text-right text-[10.5px] font-medium tracking-wide text-slate-400">
              ALM Simulation Engine · Cohort / Vintage Cash-Flow Matrix
            </p>
          </div>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <Segmented
            size="sm"
            value={currency}
            onChange={onCurrency}
            options={[
              { value: 'toman', label: 'تومان' },
              { value: 'rial', label: 'ریال' },
            ]}
          />
          <IconButton title="خروجی CSV ماتریس جریان نقد" onClick={onExportCsv}>
            <Download />
          </IconButton>
          <IconButton title="ذخیره سناریو (JSON)" onClick={onExportJson}>
            <FileBraces />
          </IconButton>
          <IconButton title="بارگذاری سناریو (JSON)" onClick={() => fileRef.current?.click()}>
            <Upload />
          </IconButton>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportJson(f);
              e.target.value = '';
            }}
          />
          <IconButton title="بازنشانی به تنظیمات پیش‌فرض" onClick={onReset}>
            <RotateCcw />
          </IconButton>
          <IconButton title={dark ? 'تم روشن' : 'تم تیره'} onClick={onToggleDark}>
            {dark ? <Sun /> : <Moon />}
          </IconButton>
        </div>
      </div>

      <div className="border-t border-slate-100 dark:border-slate-800/80">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 overflow-x-auto px-4 py-2 lg:px-6 alm-scroll">
          <nav className="flex shrink-0 items-center gap-1">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-indigo-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-300"
              >
                <n.icon className="h-3.5 w-3.5" />
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex shrink-0 items-center gap-2 text-[11.5px]">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold ring-1 ring-inset',
                safe
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25'
                  : 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25',
              )}
            >
              {safe ? <ShieldCheck className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5 animate-pulse" />}
              {safe ? 'بدون واژگونی نقدینگی' : `نقطه واژگونی: ماه ${toFa(kpis.tippingPoint ?? 0)}`}
            </span>
            <span className="hidden items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300 md:flex">
              حداکثر کسری:
              <Money compact value={-kpis.maxHole} className={kpis.maxHole > 0 ? 'text-rose-600 dark:text-rose-400' : ''} />
            </span>
            <span className="hidden items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300 lg:flex">
              اهرم خروج:
              <span className={kpis.leverage > 1 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                {fmtRatio(kpis.leverage)}×
              </span>
            </span>
            <span className="hidden items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300 xl:flex">
              حاشیهٔ خالص:
              <Money
                compact
                value={kpis.netMargin}
                className={kpis.netMargin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
              />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

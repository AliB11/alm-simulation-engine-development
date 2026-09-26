import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Info } from 'lucide-react';
import { cn } from '../utils/cn';
import { fmtCompact, fmtNumber, fmtRaw, parseNumber, toEn, toFa } from '../lib/format';
import { useDisplay } from '../context/display';

/* ------------------------------ Card ------------------------------ */

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-18px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20 [&>svg]:h-[18px] [&>svg]:w-[18px]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-7 text-slate-800 dark:text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  id,
  index,
  title,
  subtitle,
  icon,
}: {
  id: string;
  index: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <div id={id} className="mb-4 flex scroll-mt-32 items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-500/25 [&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
            {index}
          </span>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">{title}</h2>
        </div>
        {subtitle && (
          <p dir="ltr" className="text-right text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Field ------------------------------ */

export function Field({
  label,
  hint,
  info,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  info?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">
        {label}
        {info && <InfoTip text={info} />}
      </div>
      {children}
      {hint && <div className="text-[11px] leading-5 text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('group relative inline-flex cursor-help align-middle', className)} tabIndex={0}>
      <Info className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-indigo-500" />
      <span className="pointer-events-none invisible absolute bottom-full right-1/2 z-50 mb-2 w-64 translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-normal leading-5 text-slate-100 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 dark:bg-slate-700">
        {text}
      </span>
    </span>
  );
}

/* ---------------------------- NumField ---------------------------- */

const SIZES = {
  sm: { wrap: 'h-8 rounded-lg', input: 'px-2 text-[12.5px]', suffix: 'px-2 text-[11px]' },
  md: { wrap: 'h-10 rounded-xl', input: 'px-3 text-sm', suffix: 'px-2.5 text-xs' },
  lg: { wrap: 'h-12 rounded-xl', input: 'px-4 text-lg font-bold', suffix: 'px-3 text-sm' },
};

interface NumFieldProps {
  value: number | null;
  onChange: (v: number) => void;
  onClear?: () => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  money?: boolean;
  suffix?: ReactNode;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
}

/**
 * فیلد عددی فارسی: پذیرش ارقام فارسی/لاتین، جداکننده سه‌رقمی زنده،
 * اعمال محدوده مجاز هنگام خروج از فیلد و تغییر با کلیدهای جهت‌نما
 */
export function NumField({
  value,
  onChange,
  onClear,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decimals = 0,
  money = false,
  suffix,
  placeholder,
  className,
  size = 'md',
  ariaLabel,
}: NumFieldProps) {
  const { factor } = useDisplay();
  const scale = money ? factor : 1;
  const format = (v: number | null) =>
    v === null || !Number.isFinite(v) ? '' : money ? fmtRaw(Math.round(v * scale)) : fmtRaw(v, decimals);

  const [text, setText] = useState(() => format(value));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  /* همگام‌سازی مقدار بیرونی با متن فیلد.
     به‌جای effect (که یک رندر آبشاری اضافه می‌کند) از الگوی «تنظیم حالت در
     همان رندر» استفاده می‌شود: کلید همگام‌سازی فقط وقتی عوض می‌شود که مقدار،
     مقیاس واحد پول یا تعداد اعشار واقعاً تغییر کرده باشد، و تا وقتی کاربر
     داخل فیلد است متن تایپ‌شده بازنویسی نمی‌شود. */
  const syncKey = `${focused}|${value}|${scale}|${decimals}|${money}`;
  const [lastSync, setLastSync] = useState(syncKey);
  if (syncKey !== lastSync) {
    setLastSync(syncKey);
    if (!focused) setText(format(value));
  }

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || caret.current === null) return;
    const target = caret.current;
    caret.current = null;
    let pos = el.value.length;
    if (target === 0) {
      pos = el.value.startsWith('-') ? 1 : 0;
    } else {
      let count = 0;
      for (let i = 0; i < el.value.length; i++) {
        if (/[0-9۰-۹.٫]/.test(el.value[i])) {
          count++;
          if (count === target) {
            pos = i + 1;
            break;
          }
        }
      }
    }
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* ignore */
    }
  }, [text]);

  const commit = (v: number) => {
    const bounded = Math.min(max, Math.max(min, v));
    const p = Math.pow(10, decimals);
    return money ? bounded : Math.round(bounded * p) / p;
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sel = e.target.selectionStart ?? raw.length;
    const digitsBefore = (toEn(raw.slice(0, sel)).match(/[0-9.٫]/g) || []).length;
    if (raw.trim() === '') {
      setText('');
      return;
    }
    const normalized = toEn(raw).replace(/٫/g, '.');
    const parsed = parseNumber(raw);
    let display: string;
    if (money) {
      display =
        parsed === null ? raw : (normalized.trim().startsWith('-') ? '-' : '') + fmtRaw(Math.abs(Math.round(parsed)));
    } else {
      display = toFa(normalized.replace(/[^0-9.-]/g, ''));
    }
    caret.current = digitsBefore;
    setText(display);
    if (parsed !== null) {
      const v = parsed / scale;
      if (v >= min && v <= max) onChange(v);
    }
  };

  const handleBlur = () => {
    setFocused(false);
    const parsed = parseNumber(text);
    if (parsed === null) {
      if (onClear) {
        onClear();
        setText('');
      } else setText(format(value));
      return;
    }
    const v = commit(parsed / scale);
    onChange(v);
    setText(format(v));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (!money && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const cur = parseNumber(text) ?? value ?? 0;
      const v = commit(cur + (e.key === 'ArrowUp' ? step : -step));
      setText(fmtRaw(v, decimals));
      onChange(v);
    }
  };

  const s = SIZES[size];
  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden border border-slate-200 bg-white transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950/50 dark:focus-within:border-indigo-500',
        s.wrap,
        className,
      )}
    >
      <input
        ref={inputRef}
        dir="ltr"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          setFocused(true);
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKey}
        className={cn(
          'w-full min-w-0 bg-transparent text-left font-semibold tabular-nums text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-300 dark:text-slate-100 dark:placeholder:text-slate-600',
          s.input,
        )}
      />
      {suffix && (
        <span
          className={cn(
            'flex shrink-0 items-center border-r border-slate-100 bg-slate-50 font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
            s.suffix,
          )}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

/* --------------------------- SliderField --------------------------- */

export function SliderField({
  label,
  symbol,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  hint,
  color = '#6366f1',
  icon,
}: {
  label: string;
  symbol?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  color?: string;
  icon?: ReactNode;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4" style={{ color }}>
              {icon}
            </span>
          )}
          <span className="truncate text-[13px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
          {symbol && (
            <span
              dir="ltr"
              className="shrink-0 rounded-md bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700"
            >
              {symbol}
            </span>
          )}
        </div>
        <NumField
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          decimals={1}
          size="sm"
          suffix="٪"
          className="w-[92px] shrink-0"
          ariaLabel={label}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="alm-range w-full"
        style={{ '--pct': `${pct}%`, '--range-fill': color } as CSSProperties}
        aria-label={label}
      />
      {hint && <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/* ---------------------------- Segmented ---------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  full = false,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  size?: 'sm' | 'md';
  full?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200/70 dark:bg-slate-800/80 dark:ring-slate-700/60',
        full && 'flex w-full',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition [&>svg]:h-3.5 [&>svg]:w-3.5',
            size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-xs',
            full && 'flex-1',
            value === o.value
              ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-950 dark:text-indigo-300 dark:ring-slate-700'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Toggle ------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('flex items-start gap-3 text-right', className)}
    >
      <span
        className={cn(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'right-[18px]' : 'right-0.5',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">{description}</span>
        )}
      </span>
    </button>
  );
}

/* ------------------------------ Badge ------------------------------ */

const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/25',
  emerald:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25',
} as const;

export type Tone = keyof typeof BADGE_TONES;

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset [&>svg]:h-3 [&>svg]:w-3',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------ Money ------------------------------ */

export function Money({
  value,
  compact = false,
  unit = false,
  className,
}: {
  value: number;
  compact?: boolean;
  unit?: boolean;
  className?: string;
}) {
  const d = useDisplay();
  const v = value * d.factor;
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      {compact ? fmtCompact(v) : fmtNumber(Math.round(v))}
      {unit && <span className="ms-1 text-[0.82em] font-medium opacity-70">{d.unit}</span>}
    </span>
  );
}

/* ---------------------------- IconButton ---------------------------- */

export function IconButton({
  title,
  onClick,
  children,
  className,
  active,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:text-slate-300 dark:hover:border-indigo-500/60 dark:hover:text-indigo-300 [&>svg]:h-4 [&>svg]:w-4',
        active
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10'
          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  className,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-[13px]',
        variant === 'primary' &&
          'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400',
        variant === 'secondary' &&
          'border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500/60 dark:hover:text-indigo-300',
        variant === 'ghost' &&
          'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        variant === 'danger' &&
          'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

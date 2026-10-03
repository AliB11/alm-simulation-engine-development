import { useState } from 'react';
import { ChevronDown, HandCoins, Percent, Settings2, SlidersHorizontal } from 'lucide-react';
import type { GlobalConfig } from '../types';
import { useDisplay } from '../context/display';
import { fmtCompact, fmtPct } from '../lib/format';
import { IMPORT_MONEY_MAX } from '../lib/limits';
import { Button, Card, CardHeader, Field, NumField, Segmented, Toggle } from './ui';
import { cn } from '../utils/cn';

interface Props {
  config: GlobalConfig;
  onChange: (patch: Partial<GlobalConfig>) => void;
  /** اگر الگوی جاری نرخ‌های کارمزد گسسته داشته باشد، همان گزینه‌ها نمایش داده می‌شوند. */
  rateOptions?: readonly number[];
  /** سقف کل برنامه، جدا از سقف فردی که موتور روی مشتری اعمال می‌کند. */
  programCap?: number;
  /** حداقل مبلغ پرداختی محصول برای توضیح و برآورد مشتری */
  programMinLoan?: number;
}

export function GlobalConfigPanel({ config, onChange, rateOptions, programCap, programMinLoan }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const { unit, factor } = useDisplay();
  const isQard = config.contractType === 'qard';
  const rate = isQard ? config.qardFeeRate : config.murabahaRate;

  return (
    <Card>
      <CardHeader
        icon={<Settings2 />}
        title="نوار تنظیمات کلان محصول"
        subtitle="پارامترهای سراسری عقد، الزامات احتیاطی بانک مرکزی و افق زمانی شبیه‌سازی — تمام مقادیر پویا و قابل تغییرند"
        actions={
          <Button size="sm" variant="secondary" onClick={() => setAdvanced((a) => !a)}>
            <SlidersHorizontal />
            تنظیمات پیشرفته ریسک
            <ChevronDown className={cn('transition', advanced && 'rotate-180')} />
          </Button>
        }
      />
      <div className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-12">
        <Field label="نوع عقد تسهیلات" className="sm:col-span-2 xl:col-span-4">
          <Segmented
            full
            value={config.contractType}
            onChange={(v) => onChange({ contractType: v })}
            options={[
              { value: 'qard', label: 'قرض‌الحسنه (کارمزدی)', icon: <HandCoins /> },
              { value: 'murabaha', label: 'مرابحه / سودی', icon: <Percent /> },
            ]}
          />
          <div
            dir="ltr"
            className="rounded-lg bg-slate-50 px-3 py-2 text-left font-mono text-[11px] text-slate-500 ring-1 ring-slate-100 dark:bg-slate-950/50 dark:text-slate-400 dark:ring-slate-800"
          >
            {isQard ? 'PMT = (L / T) × (1 + r_f × T / 12)' : 'PMT = L × r_m(1+r_m)^T / ((1+r_m)^T − 1)'}
          </div>
        </Field>

        <Field
          label={isQard ? (rateOptions?.length ? 'کارمزد انتخابی' : 'نرخ کارمزد سالانه') : 'نرخ سود سالانه'}
          className="xl:col-span-2"
          info={
            isQard
              ? rateOptions?.length
                ? 'این درصد یکی از گزینه‌های اعلام‌شدهٔ طرح است؛ در الگوی دست‌نخوردهٔ طرح اول، انتخاب آن ضریب هر حالت را نیز از دامنهٔ همان کارمزد بازسازی می‌کند. شبیه‌ساز برای برآورد اقساط از فرض سادهٔ سالانه استفاده می‌کند، نه فرمول رسمیِ تأییدشدهٔ بانک.'
                : 'کارمزد ساده سالانه روی اصل مبلغ وام که به صورت مساوی بین اقساط سرشکن می‌شود.'
              : 'نرخ سود اسمی سالانه؛ اقساط با روش استهلاک اقساط مساوی (Annuity) محاسبه می‌شوند.'
          }
          hint={
            isQard && rateOptions?.length
              ? `گزینه‌های کارمزد این الگو: ${rateOptions.map((option) => fmtPct(option, 0)).join('، ')}`
              : isQard
                ? 'r_f — پیش‌فرض بازار: ۰ تا ۴٪'
                : 'r — نرخ مصوب تسهیلات عقود مبادله‌ای'
          }
        >
          {isQard && rateOptions?.length && rateOptions.some((option) => option === rate) ? (
            <Segmented
              full
              size="sm"
              value={String(rate)}
              onChange={(value) => onChange({ qardFeeRate: Number(value) })}
              options={rateOptions.map((option) => ({
                value: String(option),
                label: fmtPct(option, 0),
              }))}
            />
          ) : (
            <NumField
              value={rate}
              onChange={(v) => onChange(isQard ? { qardFeeRate: v } : { murabahaRate: v })}
              min={0}
              max={60}
              step={0.5}
              decimals={2}
              suffix="٪"
            />
          )}
        </Field>

        <Field
          label="نرخ سپرده قانونی (RR)"
          className="xl:col-span-2"
          info="درصدی از سپرده‌های جدید که نزد بانک مرکزی تودیع می‌شود و در جریان نقد قابل استفاده خزانه قرار نمی‌گیرد."
          hint={`منابع خالص = سپرده × (۱ − ${fmtPct(config.reserveRatio)})`}
        >
          <NumField
            value={config.reserveRatio}
            onChange={(v) => onChange({ reserveRatio: v })}
            min={0}
            max={100}
            step={0.5}
            decimals={2}
            suffix="٪"
          />
        </Field>

        <Field
          label="سقف فردی اعطای تسهیلات"
          className="xl:col-span-2"
          info={
            programCap
              ? `این سقف فردیِ مدل است؛ سقف کلِ گزارش‌شدهٔ طرح تا ${fmtCompact(programCap * factor)} ${unit} صرفاً جهت اطلاع نمایش داده می‌شود و به‌عنوان محدودیت تجمیعی پرتفوی در موتور اعمال نمی‌شود. حداقل مبلغ پرداختی این الگو ${programMinLoan ? fmtCompact(programMinLoan * factor) : 'بدون کف'} ${unit} است؛ مبالغ خام پایین‌تر از آن در برآورد مشتری و موتور تعهد ایجاد نمی‌کنند. منابع درباره سقف هر متقاضی اختلاف دارند؛ این الگو به‌طور پیش‌فرض ۳۰۰ میلیون تومان را محافظه‌کارانه برای هر فرد اعمال می‌کند.`
              : `سقف وام قابل پرداخت به هر فرد. ضریب مؤثر هر پله = min(α ، سقف ÷ مانده مبنا). مقدار صفر یعنی بدون سقف.${programMinLoan ? ` حداقل مبلغ پرداختی این الگو ${fmtCompact(programMinLoan * factor)} ${unit} است.` : ''}`
          }
          hint={config.loanCap > 0 ? `${fmtCompact(config.loanCap * factor)} ${unit}` : 'بدون سقف (۰)'}
        >
          <NumField money value={config.loanCap} onChange={(v) => onChange({ loanCap: v })} min={0} max={IMPORT_MONEY_MAX} suffix={unit} />
        </Field>

        <Field
          label="افق شبیه‌سازی"
          className="xl:col-span-2"
          info="تعداد ماه‌های ماتریس جریان وجوه نقد (پیش‌فرض ۶۰ ماه)."
          hint="t = ۰ … N"
        >
          <NumField
            value={config.horizon}
            onChange={(v) => onChange({ horizon: Math.round(v) })}
            min={12}
            max={120}
            step={6}
            suffix="ماه"
          />
        </Field>
      </div>

      {advanced && (
        <div className="grid gap-5 border-t border-dashed border-slate-200 bg-slate-50/50 p-5 dark:border-slate-800 dark:bg-slate-950/20 sm:grid-cols-2 xl:grid-cols-4">
          <Field
            label="مانده نقدینگی اولیه خزانه"
            info="CumLiq پیش از ماه صفر؛ می‌تواند مازاد موجود یا کسری قبلی (منفی) باشد."
            hint="CumLiq₋₁"
          >
            <NumField
              money
              value={config.initialLiquidity}
              onChange={(v) => onChange({ initialLiquidity: v })}
              min={-1e16}
              max={1e16}
              suffix={unit}
            />
          </Field>
          <Field
            label="نرخ نکول / معوقات اقساط"
            info="درصدی از اقساط سررسیدشده که وصول نمی‌شود و از ورودی‌های نقد کسر می‌گردد. برای اصل وصول‌نشده، ذخیرهٔ زیان موردانتظار شناسایی و پس از مهلت سوخت از مانده تسهیلات خارج می‌شود."
            hint="PMT وصولی = PMT × (۱ − نرخ نکول)"
          >
            <NumField
              value={config.defaultRate}
              onChange={(v) => onChange({ defaultRate: v })}
              min={0}
              max={100}
              decimals={2}
              suffix="٪"
            />
          </Field>
          <Field
            label="زیان در صورت نکول (LGD)"
            info="سهمی از اصل وصول‌نشده که سوخت قطعی فرض می‌شود و به همان میزان در ماه اعطای وام، هزینهٔ ذخیره مطالبات مشکوک‌الوصول (غیرنقدی) شناسایی می‌گردد. مابقی قابل‌بازیافت فرض و در مانده تسهیلات می‌ماند."
            hint="ذخیره = وام × نکول × LGD"
          >
            <NumField
              value={config.lgdRate}
              onChange={(v) => onChange({ lgdRate: v })}
              min={0}
              max={100}
              decimals={1}
              suffix="٪"
            />
          </Field>
          <Field
            label="مهلت سوخت مطالبات"
            info="تعداد ماه پس از سررسید آخرین قسط قراردادی که اصل وصول‌نشده (به میزان LGD) از مانده تسهیلات خارج می‌شود. صفر یعنی سوخت دقیقاً در ماه اتمام بازپرداخت."
            hint="سوخت در T_dep + T_loan + مهلت"
          >
            <NumField
              value={config.writeOffLag}
              onChange={(v) => onChange({ writeOffLag: Math.round(v) })}
              min={0}
              max={120}
              step={1}
              suffix="ماه"
            />
          </Field>
          <Field
            label="نرخ بازار بین‌بانکی"
            info="برای برآورد هزینه تأمین کسری نقدینگی: Σ max(0, −CumLiq_t) × r_ib / 12"
            hint="هزینه پوشش کسری از بازار"
          >
            <NumField
              value={config.interbankRate}
              onChange={(v) => onChange({ interbankRate: v })}
              min={0}
              max={100}
              decimals={2}
              suffix="٪"
            />
          </Field>
          <Field
            label="نرخ سود پرداختی سپرده"
            info="سود سالانه‌ای که بانک روی مانده سپرده‌ها می‌پردازد (سپردهٔ سرمایه‌گذاری / کوتاه‌مدت ماه‌شمار). هر ماه روی میانگین ماندهٔ ماهانه ((ابتدا + انتهای ماه) ÷ ۲) به‌عنوان یک خروجی نقد واقعی ثبت می‌شود و هم بر حاشیهٔ سود و هم بر نقطهٔ واژگونی اثر می‌گذارد."
            hint="r_dep — صفر یعنی خنثی (سپردهٔ قرض‌الحسنهٔ بدون سود)"
          >
            <NumField
              value={config.depositProfitRate}
              onChange={(v) => onChange({ depositProfitRate: v })}
              min={0}
              max={100}
              step={0.5}
              decimals={2}
              suffix="٪"
            />
          </Field>
          <Toggle
            className="sm:col-span-2 xl:col-span-4"
            checked={config.releaseReserve}
            onChange={(v) => onChange({ releaseReserve: v })}
            label="آزادسازی سپرده قانونی متناظر با برداشت سپرده"
            description="در صورت فعال‌سازی، معادل RR × برداشت در ماه سررسید به عنوان ورودی نقد به خزانه بازمی‌گردد (فراتر از فرمول پایه؛ پیش‌فرض: غیرفعال)."
          />
        </div>
      )}
    </Card>
  );
}

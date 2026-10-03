import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calculator,
  ChartArea,
  FlaskConical,
  GitCompareArrows,
  Layers,
  Settings2,
  ShieldCheck,
  SquareFunction,
  Wallet,
} from 'lucide-react';
import type { Behavior, Currency, DepositSchedule, GlobalConfig, SimInput, Tier } from './types';
import { DisplayContext, type DisplayState } from './context/display';
import { simulate } from './lib/engine';
import {
  DEFAULT_BEHAVIOR,
  DEFAULT_CONFIG,
  DEFAULT_PRESET,
  DEFAULT_SCHEDULE,
  PRESETS,
  labelTiers,
  presetTiers,
  sampleOneAlpha,
  tierColor,
} from './lib/presets';
import {
  clearState,
  exportCashFlowCsv,
  exportScenario,
  loadSlots,
  loadState,
  sanitizeState,
  saveSlots,
  saveState,
  THEME_KEY,
} from './lib/io';
import { DEFAULT_REGULATORY, type RegulatoryParams } from './lib/regulatory';
import { computeRegulatory } from './lib/regulatory';
import { tierAttribution } from './lib/attribution';
import { snapshotSlot, type ScenarioSlots, type SlotId } from './lib/scenarios';
import { Header } from './components/Header';
import { SectionHeading } from './components/ui';
import { GlobalConfigPanel } from './components/GlobalConfigPanel';
import { TierBuilder } from './components/TierBuilder';
import { CommitmentPanel } from './components/CommitmentPanel';
import { LiquidityCharts } from './components/LiquidityCharts';
import { SensitivityPanel } from './components/SensitivityPanel';
import { MonteCarloPanel } from './components/MonteCarloPanel';
import { OptimizerPanel } from './components/OptimizerPanel';
import { RegulatoryPanel } from './components/RegulatoryPanel';
import { MaturityLadder } from './components/MaturityLadder';
import { ScenarioCompare } from './components/ScenarioCompare';
import { CashFlowTable } from './components/CashFlowTable';
import { TornadoPanel } from './components/TornadoPanel';
import { CustomerCalculator } from './components/CustomerCalculator';
import { TierComparison } from './components/TierComparison';
import { Methodology } from './components/Methodology';

function initialDark(): boolean {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export default function App() {
  const saved = useMemo(() => loadState(), []);

  const [config, setConfig] = useState<GlobalConfig>(() => ({ ...DEFAULT_CONFIG, ...(saved?.config ?? {}) }));
  const [tiers, setTiersState] = useState<Tier[]>(() =>
    labelTiers(
      saved?.tiers && saved.tiers.length > 0
        ? saved.tiers
        : presetTiers(DEFAULT_PRESET, saved?.config?.qardFeeRate ?? DEFAULT_CONFIG.qardFeeRate),
    ),
  );
  const [behavior, setBehavior] = useState<Behavior>(() => ({ ...DEFAULT_BEHAVIOR, ...(saved?.behavior ?? {}) }));
  const [schedule, setSchedule] = useState<DepositSchedule>(() => ({ ...DEFAULT_SCHEDULE, ...(saved?.schedule ?? {}) }));
  const [activePreset, setActivePreset] = useState<string | null>(() =>
    saved?.activePreset ?? (saved?.tiers?.length ? null : DEFAULT_PRESET),
  );
  const [currency, setCurrency] = useState<Currency>(() => saved?.currency ?? 'toman');
  const [regulatory, setRegulatory] = useState<RegulatoryParams>(() => ({
    ...DEFAULT_REGULATORY,
    ...(saved?.regulatory ?? {}),
  }));
  const [slots, setSlots] = useState<ScenarioSlots>(() => loadSlots());
  const [dark, setDark] = useState<boolean>(initialDark);
  const [toast, setToast] = useState<string | null>(null);

  /* ---- theme & persistence ---- */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);

  useEffect(() => {
    saveState({ config, tiers, behavior, schedule, activePreset, currency, regulatory });
  }, [config, tiers, behavior, schedule, activePreset, currency, regulatory]);

  useEffect(() => {
    saveSlots(slots);
  }, [slots]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  /* ---- reactive simulation core ---- */
  const input = useMemo<SimInput>(() => ({ config, tiers, behavior, schedule }), [config, tiers, behavior, schedule]);
  const result = useMemo(() => simulate(input, true), [input]);
  const deferredInput = useDeferredValue(input);

  /* سنجه‌های مقرراتی و انتساب پله‌ها فقط به ماتریس نقدینگی و ضرایب تحلیل
     بستگی دارند؛ یک‌بار اینجا محاسبه می‌شوند و بین دو کارت بخش ۴-ت مشترک‌اند
     تا هر تغییر ورودی، آن‌ها را دوبار از نو نسازد. */
  const reg = useMemo(() => computeRegulatory(result.rows, regulatory), [result.rows, regulatory]);
  const attr = useMemo(() => tierAttribution(result.rows, tierColor), [result.rows]);

  const display = useMemo<DisplayState>(
    () => ({
      currency,
      factor: currency === 'rial' ? 10 : 1,
      unit: currency === 'rial' ? 'ریال' : 'تومان',
      dark,
    }),
    [currency, dark],
  );

  /* ---- handlers ---- */
  const patchConfig = useCallback(
    (patch: Partial<GlobalConfig>) => {
      const preset = PRESETS.find((item) => item.key === activePreset);
      const changesContract = preset && patch.contractType && patch.contractType !== preset.contractType;
      const nextQardFeeRate = patch.qardFeeRate;
      const customQardFee =
        preset?.rateOptions &&
        nextQardFeeRate !== undefined &&
        !preset.rateOptions.includes(nextQardFeeRate);
      if (changesContract || customQardFee) setActivePreset(null);

      // در الگوی دست‌نخوردهٔ طرح اول، کارمزد محصول ضریب هر ۹۰ حالت را نیز عوض می‌کند.
      // پس از ویرایش پله‌ها activePreset خالی است و ضرایب کاربر دست‌نخورده می‌مانند.
      if (
        activePreset === 'sample-1' &&
        !changesContract &&
        nextQardFeeRate !== undefined &&
        preset?.rateOptions?.includes(nextQardFeeRate)
      ) {
        setTiersState((current) =>
          current.map((tier) => ({
            ...tier,
            alpha: sampleOneAlpha(tier.tDep, tier.tLoan, nextQardFeeRate),
          })),
        );
      }
      setConfig((current) => ({ ...current, ...patch }));
    },
    [activePreset],
  );
  const patchBehavior = useCallback((p: Partial<Behavior>) => setBehavior((b) => ({ ...b, ...p })), []);
  const setTiers = useCallback((t: Tier[]) => {
    setTiersState(labelTiers(t));
    setActivePreset(null);
  }, []);

  const loadPreset = useCallback((key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setTiersState(presetTiers(key, p.rate));
    setConfig((c) => ({
      ...c,
      contractType: p.contractType,
      ...(p.contractType === 'qard' ? { qardFeeRate: p.rate } : { murabahaRate: p.rate }),
      loanCap: p.loanCap,
      minLoan: p.minLoan ?? 0,
      depositProfitRate: p.depositProfitRate,
    }));
    setActivePreset(key);
    setToast(`«${p.name}» بارگذاری شد`);
  }, []);

  const reset = useCallback(() => {
    clearState();
    setConfig(DEFAULT_CONFIG);
    setTiersState(presetTiers(DEFAULT_PRESET, DEFAULT_CONFIG.qardFeeRate));
    setBehavior(DEFAULT_BEHAVIOR);
    setSchedule(DEFAULT_SCHEDULE);
    setActivePreset(DEFAULT_PRESET);
    setRegulatory(DEFAULT_REGULATORY);
    setToast('تنظیمات به حالت پیش‌فرض بازگشت');
  }, []);

  const exportCsv = useCallback(() => {
    exportCashFlowCsv(result.rows, display.factor, display.unit);
    setToast('فایل CSV ماتریس جریان نقد دانلود شد');
  }, [result.rows, display.factor, display.unit]);

  const patchRegulatory = useCallback((p: Partial<RegulatoryParams>) => setRegulatory((r) => ({ ...r, ...p })), []);

  /* ---- تحلیل پیشرفته: اعمال خروجی بهینه‌یاب و اجرای مونت‌کارلو ---- */
  const applyTiersDesign = useCallback(
    (next: Tier[], label: string) => {
      setTiers(next);
      setToast(`${label} روی پله‌ها اعمال شد`);
    },
    [setTiers],
  );

  const loadPerturbedRun = useCallback(
    (patch: { behavior: Behavior; config: GlobalConfig; schedule: DepositSchedule }, label: string) => {
      setBehavior(patch.behavior);
      setConfig(patch.config);
      setSchedule(patch.schedule);
      setActivePreset(null);
      setToast(`${label} در برنامه بارگذاری شد`);
    },
    [],
  );

  /* ---- جایگاه‌های مقایسهٔ سناریو (A / B / C) ---- */
  const snapshotToSlot = useCallback(
    (id: SlotId) => {
      setSlots((s) => ({ ...s, [id]: snapshotSlot(id, input, result.kpis) }));
      setToast(`سناریوی جاری در جایگاه ${id} ذخیره شد`);
    },
    [input, result.kpis],
  );

  const loadSlot = useCallback(
    (id: SlotId) => {
      const slot = slots[id];
      if (!slot) return;
      setConfig(slot.config);
      setTiersState(labelTiers(slot.tiers));
      setBehavior(slot.behavior);
      setSchedule(slot.schedule);
      setActivePreset(null);
      setToast(`«${slot.name}» در برنامه بارگذاری شد`);
    },
    [slots],
  );

  const clearSlot = useCallback((id: SlotId) => {
    setSlots((s) => (s[id] ? { ...s, [id]: null } : s));
    setToast(`جایگاه ${id} خالی شد`);
  }, []);

  const renameSlot = useCallback((id: SlotId, name: string) => {
    setSlots((s) => (s[id] ? { ...s, [id]: { ...(s[id] as ScenarioSlots[SlotId]), name } } : s));
  }, []);

  const exportJson = useCallback(() => {
    exportScenario({ config, tiers, behavior, schedule, activePreset, currency, regulatory });
    setToast('سناریو ذخیره شد');
  }, [config, tiers, behavior, schedule, activePreset, currency, regulatory]);

  const importJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = sanitizeState(JSON.parse(String(reader.result)));
        if (!data) throw new Error('invalid');
        if (data.config) setConfig({ ...DEFAULT_CONFIG, ...data.config });
        if (data.tiers) setTiersState(labelTiers(data.tiers));
        if (data.behavior) setBehavior({ ...DEFAULT_BEHAVIOR, ...data.behavior });
        if (data.schedule) setSchedule({ ...DEFAULT_SCHEDULE, ...data.schedule });
        if (data.currency) setCurrency(data.currency);
        if (data.regulatory) setRegulatory({ ...DEFAULT_REGULATORY, ...data.regulatory });
        setActivePreset(data.activePreset ?? null);
        setToast('سناریو با موفقیت بارگذاری شد');
      } catch {
        setToast('فایل سناریو معتبر نیست');
      }
    };
    reader.onerror = () => setToast('خواندن فایل ناموفق بود');
    reader.readAsText(file);
  }, []);

  return (
    <DisplayContext.Provider value={display}>
      <div className="relative min-h-screen bg-slate-50 text-slate-800 transition-colors dark:bg-slate-950 dark:text-slate-100">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden">
          <div className="absolute -top-40 right-[10%] h-[420px] w-[420px] rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-600/15" />
          <div className="absolute -top-24 left-[5%] h-[360px] w-[360px] rounded-full bg-sky-300/20 blur-3xl dark:bg-violet-600/10" />
        </div>

        <Header
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          currency={currency}
          onCurrency={setCurrency}
          onReset={reset}
          onExportCsv={exportCsv}
          onExportJson={exportJson}
          onImportJson={importJson}
          kpis={result.kpis}
        />

        <a
          href="#config"
          className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-[13px] focus:font-bold focus:text-white"
        >
          پرش به محتوای اصلی
        </a>

        <main className="relative mx-auto max-w-[1600px] space-y-12 px-4 py-8 lg:px-6">
          <section>
            <SectionHeading
              id="config"
              index="بخش ۱"
              title="تنظیمات کلان محصول"
              subtitle="GLOBAL PRODUCT CONFIGURATION"
              icon={<Settings2 />}
            />
            <GlobalConfigPanel
              config={config}
              onChange={patchConfig}
              rateOptions={PRESETS.find((preset) => preset.key === activePreset)?.rateOptions}
              programCap={PRESETS.find((preset) => preset.key === activePreset)?.programCap}
              programMinLoan={PRESETS.find((preset) => preset.key === activePreset)?.minLoan}
            />
          </section>

          <section>
            <SectionHeading
              id="tiers"
              index="بخش ۲"
              title="سازنده پویای پله‌های محصول"
              subtitle="DYNAMIC TIER BUILDER"
              icon={<Layers />}
            />
            <TierBuilder
              tiers={tiers}
              results={result.tiers}
              config={config}
              activePreset={activePreset}
              onChange={setTiers}
              onLoadPreset={loadPreset}
            />
          </section>

          <section>
            <SectionHeading
              id="commitments"
              index="بخش ۳"
              title="ورود منابع و داشبورد تعهدات"
              subtitle="COMMITMENT ENGINE & KPI DASHBOARD"
              icon={<Wallet />}
            />
            <CommitmentPanel
              behavior={behavior}
              onBehavior={patchBehavior}
              schedule={schedule}
              onSchedule={setSchedule}
              config={config}
              result={result}
            />
            <div id="cashflow" className="scroll-mt-32 pt-6">
              <CashFlowTable
                result={result}
                config={config}
                initialLiquidity={config.initialLiquidity}
                onExportCsv={exportCsv}
              />
            </div>
          </section>

          <section>
            <SectionHeading
              id="charts"
              index="بخش ۴"
              title="تحلیل بصری ریسک نقدینگی"
              subtitle="LIQUIDITY RISK CHARTS"
              icon={<ChartArea />}
            />
            <LiquidityCharts result={result} horizon={config.horizon} />
          </section>

          <section>
            <SectionHeading
              id="stress"
              index="بخش ۴-ب"
              title="آزمون حساسیت و سناریوهای بحران"
              subtitle="2D SENSITIVITY / STRESS TESTING"
              icon={<FlaskConical />}
            />
            <div className="space-y-6">
              <SensitivityPanel input={deferredInput} />
              <TornadoPanel input={deferredInput} />
            </div>
          </section>

          <section>
            <SectionHeading
              id="advanced"
              index="بخش ۴-پ"
              title="تحلیل پیشرفته: آزمون مونت‌کارلو و بهینه‌یاب طراحی"
              subtitle="MONTE CARLO / VaR & INVERSE DESIGN OPTIMIZER"
              icon={<Activity />}
            />
            <div className="space-y-6">
              <MonteCarloPanel input={deferredInput} onLoadRun={loadPerturbedRun} />
              <OptimizerPanel input={deferredInput} onApply={applyTiersDesign} />
            </div>
          </section>

          <section>
            <SectionHeading
              id="regulatory"
              index="بخش ۴-ت"
              title="سنجه‌های مقرراتی‌مانند و نردبان سررسید"
              subtitle="LCR / NSFR / MATURITY GAP PROXIES & TIER ATTRIBUTION"
              icon={<ShieldCheck />}
            />
            <div className="space-y-6">
              <RegulatoryPanel config={config} params={regulatory} onParams={patchRegulatory} reg={reg} />
              <MaturityLadder result={result} config={config} reg={reg} attr={attr} />
            </div>
          </section>

          <section>
            <SectionHeading
              id="scenarios"
              index="بخش ۴-ث"
              title="مقایسهٔ سناریوها (A / B / C)"
              subtitle="SCENARIO SLOTS · SIDE-BY-SIDE KPI AND LIQUIDITY COMPARISON"
              icon={<GitCompareArrows />}
            />
            <ScenarioCompare
              kpis={result.kpis}
              currentRows={result.rows}
              slots={slots}
              onSnapshot={snapshotToSlot}
              onLoad={loadSlot}
              onClear={clearSlot}
              onRename={renameSlot}
            />
          </section>

          <section>
            <SectionHeading
              id="customer-calculator"
              index="بخش ۵"
              title="محاسبه‌گر تسهیلات مشتری"
              subtitle="CUSTOMER LOAN ESTIMATE · ELIGIBILITY & MONTHLY INSTALLMENT"
              icon={<Calculator />}
            />
            <div className="space-y-6">
              <CustomerCalculator tiers={tiers} config={config} />
              <TierComparison tiers={tiers} config={config} onOpportunityRate={(v) => patchConfig({ opportunityRate: v })} />
            </div>
          </section>

          <section>
            <SectionHeading
              id="method"
              index="پیوست"
              title="روش‌شناسی و فرمول‌های موتور شبیه‌ساز"
              subtitle="METHODOLOGY & LIVE FORMULA TRACE"
              icon={<SquareFunction />}
            />
            <Methodology result={result} config={config} behavior={behavior} regulatory={regulatory} />
          </section>
        </main>

        <footer className="relative border-t border-slate-200 bg-white/60 py-6 text-center text-[11.5px] leading-6 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <div className="mx-auto max-w-[1600px] px-4">
            موتور شبیه‌سازی مدیریت دارایی و بدهی (ALM) · محاسبات کاملاً پویا بر پایه ماتریس جریان وجوه نقد ویژه‌محور (Cohort/Vintage)
            <br />
            ارقام نمونه صرفاً برای شروع طراحی هستند و قابل ویرایش‌اند؛ نتایج برآوردی‌اند و جایگزین پیشنهاد قطعی تسهیلات یا اعتبارسنجی نیستند.
          </div>
        </footer>

        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-2xl ring-1 ring-white/10 dark:bg-slate-800"
          >
            {toast}
          </div>
        )}
      </div>
    </DisplayContext.Provider>
  );
}

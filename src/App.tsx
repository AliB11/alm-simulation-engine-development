import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Activity, ChartArea, FlaskConical, Layers, Settings2, ShieldCheck, SquareFunction, Table2, Wallet } from 'lucide-react';
import type { Behavior, Currency, DepositSchedule, GlobalConfig, SimInput, Tier } from './types';
import { DisplayContext, type DisplayState } from './context/display';
import { simulate } from './lib/engine';
import {
  DEFAULT_BEHAVIOR,
  DEFAULT_CONFIG,
  DEFAULT_PRESET,
  DEFAULT_SCHEDULE,
  PRESETS,
  presetTiers,
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
import { EMPTY_SLOTS, snapshotSlot, type ScenarioSlots, type SlotId } from './lib/scenarios';
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
import { TierComparison } from './components/TierComparison';
import { CashFlowTable } from './components/CashFlowTable';
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
    saved?.tiers && saved.tiers.length > 0 ? saved.tiers : presetTiers(DEFAULT_PRESET),
  );
  const [behavior, setBehavior] = useState<Behavior>(() => ({ ...DEFAULT_BEHAVIOR, ...(saved?.behavior ?? {}) }));
  const [schedule, setSchedule] = useState<DepositSchedule>(() => ({ ...DEFAULT_SCHEDULE, ...(saved?.schedule ?? {}) }));
  const [activePreset, setActivePreset] = useState<string | null>(() =>
    saved && 'activePreset' in saved ? (saved.activePreset ?? null) : DEFAULT_PRESET,
  );
  const [currency, setCurrency] = useState<Currency>(() => saved?.currency ?? 'toman');
  const [regulatory, setRegulatory] = useState<RegulatoryParams>(() => ({
    ...DEFAULT_REGULATORY,
    ...(saved?.regulatory ?? {}),
  }));
  const [slots, setSlots] = useState<ScenarioSlots>(() => loadSlots() ?? EMPTY_SLOTS);
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
  const patchConfig = useCallback((p: Partial<GlobalConfig>) => setConfig((c) => ({ ...c, ...p })), []);
  const patchBehavior = useCallback((p: Partial<Behavior>) => setBehavior((b) => ({ ...b, ...p })), []);
  const setTiers = useCallback((t: Tier[]) => {
    setTiersState(t);
    setActivePreset(null);
  }, []);

  const loadPreset = useCallback((key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setTiersState(presetTiers(key));
    setConfig((c) => ({
      ...c,
      contractType: p.contractType,
      ...(p.contractType === 'qard' ? { qardFeeRate: p.rate } : { murabahaRate: p.rate }),
      loanCap: p.loanCap,
      depositProfitRate: p.depositProfitRate,
    }));
    setActivePreset(key);
    setToast(`پیش‌تنظیم «${p.name}» بارگذاری شد`);
  }, []);

  const reset = useCallback(() => {
    clearState();
    setConfig(DEFAULT_CONFIG);
    setTiersState(presetTiers(DEFAULT_PRESET));
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
  const applyTiersDesign = useCallback((next: Tier[], label: string) => {
    setTiersState(next);
    setActivePreset(null);
    setToast(`${label} روی پله‌ها اعمال شد`);
  }, []);

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

  /* ---- مقایسهٔ سناریو A/B/C ---- */
  const snapshotScenario = useCallback(
    (id: SlotId) => {
      setSlots((s) => ({ ...s, [id]: snapshotSlot(id, input, result.kpis) }));
      setToast(`سناریوی جاری در جایگاه ${id} ذخیره شد`);
    },
    [input, result.kpis],
  );

  const loadScenario = useCallback(
    (id: SlotId) => {
      const slot = slots[id];
      if (!slot) return;
      setConfig(slot.config);
      setTiersState(slot.tiers);
      setBehavior(slot.behavior);
      setSchedule(slot.schedule);
      setActivePreset(null);
      setToast(`سناریوی جایگاه ${id} بارگذاری شد`);
    },
    [slots],
  );

  const clearScenario = useCallback((id: SlotId) => {
    setSlots((s) => ({ ...s, [id]: null }));
    setToast(`جایگاه ${id} پاک شد`);
  }, []);

  const renameScenario = useCallback((id: SlotId, name: string) => {
    setSlots((s) => (s[id] ? { ...s, [id]: { ...s[id]!, name: name.slice(0, 60) } } : s));
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
        if (data.tiers) setTiersState(data.tiers);
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

        <main className="relative mx-auto max-w-[1600px] space-y-12 px-4 py-8 lg:px-6">
          <section>
            <SectionHeading
              id="config"
              index="بخش ۱"
              title="تنظیمات کلان محصول"
              subtitle="GLOBAL PRODUCT CONFIGURATION"
              icon={<Settings2 />}
            />
            <GlobalConfigPanel config={config} onChange={patchConfig} />
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
            <SensitivityPanel input={deferredInput} />
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
              <RegulatoryPanel result={result} config={config} params={regulatory} onParams={patchRegulatory} />
              <MaturityLadder result={result} config={config} params={regulatory} />
            </div>
          </section>

          <section>
            <SectionHeading
              id="tables"
              index="بخش ۵"
              title="مقایسه سناریوها، پله‌ها و ریز جریان نقدینگی"
              subtitle="SCENARIO A/B/C · TIER COMPARISON · MONTHLY CASH-FLOW MATRIX"
              icon={<Table2 />}
            />
            <div className="space-y-6">
              <ScenarioCompare
                kpis={result.kpis}
                currentRows={result.rows}
                slots={slots}
                onSnapshot={snapshotScenario}
                onLoad={loadScenario}
                onClear={clearScenario}
                onRename={renameScenario}
              />
              <TierComparison tiers={tiers} config={config} />
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
            ارقام پیش‌تنظیم‌ها برگرفته از اطلاعات عمومی منتشرشده بوده و برخی ضرایب تقریبی‌اند؛ نتایج صرفاً جنبه تحلیلی و شبیه‌سازی دارد.
          </div>
        </footer>

        {toast && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-2xl ring-1 ring-white/10 dark:bg-slate-800">
            {toast}
          </div>
        )}
      </div>
    </DisplayContext.Provider>
  );
}

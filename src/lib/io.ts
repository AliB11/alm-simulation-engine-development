import type { Behavior, Currency, DepositSchedule, GlobalConfig, MonthRow, SimKpis, Tier } from '../types';
import { DEFAULT_BEHAVIOR, DEFAULT_CONFIG, DEFAULT_SCHEDULE, PRESETS } from './presets';
import { EVENT_META } from './eventMeta';
import { IMPORT_MONEY_MAX, IMPORT_RATE_MAX, TIER_ALPHA_MAX } from './limits';
import { DEFAULT_REGULATORY, type RegulatoryParams } from './regulatory';
import { EMPTY_SLOTS, SLOT_IDS, type ScenarioSlot, type ScenarioSlots } from './scenarios';

const STATE_KEY = 'alm-sim-state-v2';
const SLOTS_KEY = 'alm-sim-scenario-slots-v1';
export const THEME_KEY = 'alm-theme';

export interface PersistedState {
  config: GlobalConfig;
  tiers: Tier[];
  behavior: Behavior;
  schedule: DepositSchedule;
  activePreset: string | null;
  currency: Currency;
  /** ضرایب سنجه‌های مقرراتی‌مانند — اختیاری تا بارهای قدیمی معتبر بمانند */
  regulatory?: RegulatoryParams;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  const safe = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  return integer ? Math.round(safe) : safe;
}

function sanitizeConfig(v: unknown): GlobalConfig | undefined {
  if (!isObj(v)) return undefined;
  return {
    contractType: v.contractType === 'murabaha' ? 'murabaha' : 'qard',
    qardFeeRate: finiteNumber(v.qardFeeRate, DEFAULT_CONFIG.qardFeeRate, 0, IMPORT_RATE_MAX),
    murabahaRate: finiteNumber(v.murabahaRate, DEFAULT_CONFIG.murabahaRate, 0, IMPORT_RATE_MAX),
    reserveRatio: finiteNumber(v.reserveRatio, DEFAULT_CONFIG.reserveRatio, 0, 100),
    loanCap: finiteNumber(v.loanCap, DEFAULT_CONFIG.loanCap, 0, IMPORT_MONEY_MAX),
    horizon: finiteNumber(v.horizon, DEFAULT_CONFIG.horizon, 12, 120, true),
    initialLiquidity: finiteNumber(v.initialLiquidity, DEFAULT_CONFIG.initialLiquidity, -IMPORT_MONEY_MAX, IMPORT_MONEY_MAX),
    releaseReserve: typeof v.releaseReserve === 'boolean' ? v.releaseReserve : DEFAULT_CONFIG.releaseReserve,
    defaultRate: finiteNumber(v.defaultRate, DEFAULT_CONFIG.defaultRate, 0, 100),
    lgdRate: finiteNumber(v.lgdRate, DEFAULT_CONFIG.lgdRate, 0, 100),
    writeOffLag: finiteNumber(v.writeOffLag, DEFAULT_CONFIG.writeOffLag, 0, 600, true),
    interbankRate: finiteNumber(v.interbankRate, DEFAULT_CONFIG.interbankRate, 0, 100),
    opportunityRate: finiteNumber(v.opportunityRate, DEFAULT_CONFIG.opportunityRate, 0, 100),
    depositProfitRate: finiteNumber(v.depositProfitRate, DEFAULT_CONFIG.depositProfitRate, 0, 100),
  };
}

function sanitizeBehavior(v: unknown): Behavior | undefined {
  if (!isObj(v)) return undefined;
  return {
    totalDeposit: finiteNumber(v.totalDeposit, DEFAULT_BEHAVIOR.totalDeposit, 0, IMPORT_MONEY_MAX),
    avgTicket: finiteNumber(v.avgTicket, DEFAULT_BEHAVIOR.avgTicket, 0, IMPORT_MONEY_MAX),
    takeUpRate: finiteNumber(v.takeUpRate, DEFAULT_BEHAVIOR.takeUpRate, 0, 100),
    approvalRate: finiteNumber(v.approvalRate, DEFAULT_BEHAVIOR.approvalRate, 0, 100),
    runoffRate: finiteNumber(v.runoffRate, DEFAULT_BEHAVIOR.runoffRate, 0, 100),
    churnRate: finiteNumber(v.churnRate, DEFAULT_BEHAVIOR.churnRate, 0, 100),
  };
}

function sanitizeTiers(v: unknown): Tier[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Tier[] = [];
  const ids = new Set<string>();
  v.slice(0, 500).forEach((item, i) => {
    if (!isObj(item)) return;
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.slice(0, 100) : `import-tier-${i}`;
    while (ids.has(id)) id = `import-tier-${i}-${ids.size}`;
    ids.add(id);
    out.push({
      id,
      name: typeof item.name === 'string' ? item.name.slice(0, 120) : `پله ${i + 1}`,
      tDep: finiteNumber(item.tDep, 1, 1, 12, true),
      tLoan: finiteNumber(item.tLoan, 12, 6, 60, true),
      alpha: finiteNumber(item.alpha, 100, 0, TIER_ALPHA_MAX),
      minBalance: finiteNumber(item.minBalance, 0, 0, IMPORT_MONEY_MAX),
      allocation: finiteNumber(item.allocation, 0, 0, 100),
      rateOverride:
        item.rateOverride === null || item.rateOverride === undefined
          ? null
          : finiteNumber(item.rateOverride, 0, 0, 60),
    });
  });
  return out;
}

function sanitizeRegulatory(v: unknown): RegulatoryParams | undefined {
  if (!isObj(v)) return undefined;
  return {
    stressRunoff: finiteNumber(v.stressRunoff, DEFAULT_REGULATORY.stressRunoff, 0, 100),
    stableWeight: finiteNumber(v.stableWeight, DEFAULT_REGULATORY.stableWeight, 0, 100),
    loanWeight: finiteNumber(v.loanWeight, DEFAULT_REGULATORY.loanWeight, 0, 100),
    wholesaleShare: finiteNumber(v.wholesaleShare, DEFAULT_REGULATORY.wholesaleShare, 0, 100),
    wholesaleRunoff: finiteNumber(v.wholesaleRunoff, DEFAULT_REGULATORY.wholesaleRunoff, 0, 100),
    hqlaHaircut: finiteNumber(v.hqlaHaircut, DEFAULT_REGULATORY.hqlaHaircut, 0, 100),
  };
}

function sanitizeSchedule(v: unknown, horizon: number): DepositSchedule | undefined {
  if (!isObj(v)) return undefined;
  const mode = v.mode === 'uniform' || v.mode === 'custom' ? v.mode : 'lump';
  const custom: DepositSchedule['custom'] = [];
  const ids = new Set<string>();
  if (Array.isArray(v.custom)) {
    v.custom.slice(0, 1000).forEach((item, i) => {
      if (!isObj(item)) return;
      let id = typeof item.id === 'string' && item.id.trim() ? item.id.slice(0, 100) : `import-vintage-${i}`;
      while (ids.has(id)) id = `import-vintage-${i}-${ids.size}`;
      ids.add(id);
      custom.push({
        id,
        month: finiteNumber(item.month, 0, 0, horizon, true),
        share: finiteNumber(item.share, 0, 0, 100),
      });
    });
  }
  return {
    mode,
    uniformMonths: finiteNumber(v.uniformMonths, DEFAULT_SCHEDULE.uniformMonths, 1, horizon + 1, true),
    custom,
  };
}

export function sanitizeState(raw: unknown): Partial<PersistedState> | null {
  if (!isObj(raw)) return null;
  const out: Partial<PersistedState> = {};
  const config = sanitizeConfig(raw.config);
  if (config) out.config = config;
  const behavior = sanitizeBehavior(raw.behavior);
  if (behavior) out.behavior = behavior;
  const schedule = sanitizeSchedule(raw.schedule, config?.horizon ?? DEFAULT_CONFIG.horizon);
  if (schedule) out.schedule = schedule;
  const tiers = sanitizeTiers(raw.tiers);
  if (tiers) out.tiers = tiers;
  if (typeof raw.activePreset === 'string' && PRESETS.some((p) => p.key === raw.activePreset)) {
    out.activePreset = raw.activePreset;
  } else if (raw.activePreset === null) {
    out.activePreset = null;
  }
  if (raw.currency === 'toman' || raw.currency === 'rial') out.currency = raw.currency;
  const regulatory = sanitizeRegulatory(raw.regulatory);
  if (regulatory) out.regulatory = regulatory;
  // A payload without a single recognizable section is not a scenario at all —
  // rejecting it keeps a bogus file from silently wiping the active preset.
  if (Object.keys(out).length === 0) return null;
  return out;
}

export function loadState(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveState(s: PersistedState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ساخت متن CSV ماتریس جریان نقد (بدون دانلود) — قابل آزمون در محیط نود */
export function buildCashFlowCsv(rows: MonthRow[], factor: number, unit: string): string {
  const header = [
    'ماه',
    `سپرده جدید (${unit})`,
    `سپرده قانونی (${unit})`,
    `سپرده خالص ورودی (${unit})`,
    `اقساط وصولی (${unit})`,
    `اصل اقساط (${unit})`,
    `کارمزد/سود وصولی (${unit})`,
    `آزادسازی سپرده قانونی (${unit})`,
    `جمع ورودی (${unit})`,
    `تعهد اعطای وام (${unit})`,
    `خروج سپرده (${unit})`,
    `سود پرداختی سپرده (${unit})`,
    `جمع خروجی (${unit})`,
    `خالص جریان نقد NCF (${unit})`,
    `نقدینگی تجمعی CumLiq (${unit})`,
    `مانده سپرده (${unit})`,
    `مانده تسهیلات (${unit})`,
    `هزینه تامین کسری ماهانه (${unit})`,
    `هزینه ذخیره مطالبات - غیرنقدی (${unit})`,
    `سوخت مطالبات از مانده تسهیلات - غیرنقدی (${unit})`,
    `حاشیه تجمعی بانک (${unit})`,
  ];
  const r = (v: number) => Math.round(v * factor);
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.t,
        r(row.depositGross),
        r(row.reserveHeld),
        r(row.depositNet),
        r(row.pmtInflow),
        r(row.principalIn),
        r(row.incomeIn),
        r(row.reserveRelease),
        r(row.inflow),
        r(row.loanOut),
        r(row.withdrawalOut),
        r(row.profitPaid),
        r(row.outflow),
        r(row.ncf),
        r(row.cum),
        r(row.depositBalance),
        r(row.loanBook),
        r(row.fundingCost),
        r(row.provisionCost),
        r(row.writeOff),
        r(row.cumMargin),
      ].join(','),
    );
  }
  return '\uFEFF' + lines.join('\n');
}

export function exportCashFlowCsv(rows: MonthRow[], factor: number, unit: string) {
  downloadFile('alm-cashflow-matrix.csv', buildCashFlowCsv(rows, factor, unit), 'text/csv;charset=utf-8;');
}

/* ------------------------- خروجی دفتر کل رویدادمحور ------------------------- */

const LEDGER_ORDER: MonthRow['events'][number]['type'][] = [
  'deposit',
  'reserve',
  'release',
  'pmt',
  'loan',
  'withdrawal',
  'profit',
];

/**
 * دفتر کل کامل: هر رویداد ثبت‌شده در ماتریس جریان نقد به یک سطر تبدیل
 * می‌شود (ماه، نوع رویداد، پله، بازهٔ ویژه‌ها، قسط، مبلغ با علامت، جهت).
 * این خروجی برای انتقال به اکسل/BI و راستی‌آزمایی دستی ارقام موتور است.
 */
/** ساخت متن CSV دفتر کل رویدادمحور (بدون دانلود) — قابل آزمون در محیط نود */
export function buildLedgerCsv(rows: MonthRow[], factor: number, unit: string): string {
  const csvText = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = [
    'ماه',
    'رویداد',
    'پله',
    'بازه ویژه',
    'تعداد ویژه',
    'اقساط',
    `مبلغ (${unit})`,
    'جهت',
    `خالص جریان نقد ماه (${unit})`,
    `نقدینگی تجمعی (${unit})`,
    `مانده سپرده (${unit})`,
    `مانده تسهیلات (${unit})`,
  ];
  const r = (v: number) => Math.round(v * factor);
  const lines = [header.join(',')];
  let total = 0;
  for (const row of rows) {
    const events = row.events.slice().sort((a, b) => LEDGER_ORDER.indexOf(a.type) - LEDGER_ORDER.indexOf(b.type));
    for (const e of events) {
      const meta = EVENT_META[e.type];
      const signed = meta.sign * e.amount;
      total += signed;
      const vintage =
        e.vintageFrom === e.vintageTo ? `${e.vintageFrom}` : `${e.vintageFrom}-${e.vintageTo}`;
      const inst =
        e.instFrom !== undefined && e.instTo !== undefined && e.instTotal !== undefined
          ? e.instFrom === e.instTo
            ? `${e.instFrom}/${e.instTotal}`
            : `${e.instFrom}-${e.instTo}/${e.instTotal}`
          : '';
      lines.push(
        [
          row.t,
          csvText(meta.label),
          csvText(e.tierName),
          vintage,
          e.vintages,
          inst,
          r(signed),
          csvText(meta.sign > 0 ? 'ورودی' : 'خروجی'),
          r(row.ncf),
          r(row.cum),
          r(row.depositBalance),
          r(row.loanBook),
        ].join(','),
      );
    }
  }
  lines.push(['', csvText('جمع کل'), '', '', '', '', r(total), '', '', '', '', ''].join(','));
  return '\uFEFF' + lines.join('\n');
}

export function exportLedgerCsv(rows: MonthRow[], factor: number, unit: string) {
  downloadFile('alm-general-ledger.csv', buildLedgerCsv(rows, factor, unit), 'text/csv;charset=utf-8;');
}

/* ----------------------------- جایگاه‌های سناریو ----------------------------- */

const ZERO_KPIS: SimKpis = {
  totalDeposit: 0,
  netDeposit: 0,
  reserveHeld: 0,
  totalCommitment: 0,
  totalWithdrawal: 0,
  leverage: 0,
  minCum: 0,
  minCumMonth: 0,
  maxHole: 0,
  tippingPoint: null,
  recoveryMonth: null,
  deficitMonths: 0,
  endCum: 0,
  totalPmtInHorizon: 0,
  totalIncomeInHorizon: 0,
  pmtBeyondHorizon: 0,
  commitmentsBeyondHorizon: 0,
  interbankCost: 0,
  borrowers: 0,
  peakOutflow: 0,
  peakOutflowMonth: 0,
  totalProfitPaid: 0,
  netInterestIncome: 0,
  totalProvision: 0,
  totalWriteOff: 0,
  netMargin: 0,
  marginOnNetDeposit: 0,
};

const NULLABLE_KPIS: (keyof SimKpis)[] = ['tippingPoint', 'recoveryMonth'];

function sanitizeKpis(v: unknown): SimKpis | undefined {
  if (!isObj(v)) return undefined;
  const out: SimKpis = { ...ZERO_KPIS };
  const bag = out as unknown as Record<string, number | null>;
  for (const key of Object.keys(ZERO_KPIS) as (keyof SimKpis)[]) {
    const raw = v[key];
    if (raw === null || raw === undefined) {
      if (NULLABLE_KPIS.includes(key)) bag[key] = null;
      continue;
    }
    const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n)) bag[key] = n;
  }
  return out;
}

function sanitizeSlot(raw: unknown): ScenarioSlot | undefined {
  if (!isObj(raw)) return undefined;
  const config = sanitizeConfig(raw.config);
  const behavior = sanitizeBehavior(raw.behavior);
  const tiers = sanitizeTiers(raw.tiers);
  const kpis = sanitizeKpis(raw.kpis);
  if (!config || !behavior || !tiers || !kpis) return undefined;
  const schedule = sanitizeSchedule(raw.schedule, config.horizon) ?? DEFAULT_SCHEDULE;
  const savedAt = Number(raw.savedAt);
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'سناریوی ذخیره‌شده',
    savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
    config,
    tiers,
    behavior,
    schedule,
    kpis,
  };
}

export function sanitizeSlots(raw: unknown): ScenarioSlots {
  const out: ScenarioSlots = { ...EMPTY_SLOTS };
  if (!isObj(raw)) return out;
  for (const id of SLOT_IDS) {
    const slot = sanitizeSlot(raw[id]);
    if (slot) out[id] = slot;
  }
  return out;
}

export function loadSlots(): ScenarioSlots {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    return raw ? sanitizeSlots(JSON.parse(raw)) : { ...EMPTY_SLOTS };
  } catch {
    return { ...EMPTY_SLOTS };
  }
}

export function saveSlots(slots: ScenarioSlots) {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    /* ignore quota errors */
  }
}

export function clearSlots() {
  try {
    localStorage.removeItem(SLOTS_KEY);
  } catch {
    /* ignore */
  }
}

export function exportScenario(state: PersistedState) {
  const payload = { app: 'alm-simulation-engine', version: 2, exportedAt: new Date().toISOString(), ...state };
  downloadFile('alm-scenario.json', JSON.stringify(payload, null, 2), 'application/json');
}

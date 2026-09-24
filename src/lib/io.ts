import type { Behavior, Currency, DepositSchedule, GlobalConfig, MonthRow, Tier } from '../types';
import { DEFAULT_BEHAVIOR, DEFAULT_CONFIG, DEFAULT_SCHEDULE, PRESETS } from './presets';

const STATE_KEY = 'alm-sim-state-v2';
export const THEME_KEY = 'alm-theme';

export interface PersistedState {
  config: GlobalConfig;
  tiers: Tier[];
  behavior: Behavior;
  schedule: DepositSchedule;
  activePreset: string | null;
  currency: Currency;
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
    qardFeeRate: finiteNumber(v.qardFeeRate, DEFAULT_CONFIG.qardFeeRate, 0, 60),
    murabahaRate: finiteNumber(v.murabahaRate, DEFAULT_CONFIG.murabahaRate, 0, 60),
    reserveRatio: finiteNumber(v.reserveRatio, DEFAULT_CONFIG.reserveRatio, 0, 100),
    loanCap: finiteNumber(v.loanCap, DEFAULT_CONFIG.loanCap, 0, 1e16),
    horizon: finiteNumber(v.horizon, DEFAULT_CONFIG.horizon, 12, 120, true),
    initialLiquidity: finiteNumber(v.initialLiquidity, DEFAULT_CONFIG.initialLiquidity, -1e16, 1e16),
    releaseReserve: typeof v.releaseReserve === 'boolean' ? v.releaseReserve : DEFAULT_CONFIG.releaseReserve,
    defaultRate: finiteNumber(v.defaultRate, DEFAULT_CONFIG.defaultRate, 0, 100),
    interbankRate: finiteNumber(v.interbankRate, DEFAULT_CONFIG.interbankRate, 0, 100),
    opportunityRate: finiteNumber(v.opportunityRate, DEFAULT_CONFIG.opportunityRate, 0, 100),
  };
}

function sanitizeBehavior(v: unknown): Behavior | undefined {
  if (!isObj(v)) return undefined;
  return {
    totalDeposit: finiteNumber(v.totalDeposit, DEFAULT_BEHAVIOR.totalDeposit, 0, 1e16),
    avgTicket: finiteNumber(v.avgTicket, DEFAULT_BEHAVIOR.avgTicket, 0, 1e16),
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
      alpha: finiteNumber(item.alpha, 100, 0, 500),
      minBalance: finiteNumber(item.minBalance, 0, 0, 1e16),
      allocation: finiteNumber(item.allocation, 0, 0, 100),
      rateOverride:
        item.rateOverride === null || item.rateOverride === undefined
          ? null
          : finiteNumber(item.rateOverride, 0, 0, 60),
    });
  });
  return out;
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

export function exportCashFlowCsv(rows: MonthRow[], factor: number, unit: string) {
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
    `جمع خروجی (${unit})`,
    `خالص جریان نقد NCF (${unit})`,
    `نقدینگی تجمعی CumLiq (${unit})`,
    `مانده سپرده (${unit})`,
    `مانده تسهیلات (${unit})`,
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
        r(row.outflow),
        r(row.ncf),
        r(row.cum),
        r(row.depositBalance),
        r(row.loanBook),
      ].join(','),
    );
  }
  downloadFile('alm-cashflow-matrix.csv', '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8;');
}

export function exportScenario(state: PersistedState) {
  const payload = { app: 'alm-simulation-engine', version: 2, exportedAt: new Date().toISOString(), ...state };
  downloadFile('alm-scenario.json', JSON.stringify(payload, null, 2), 'application/json');
}

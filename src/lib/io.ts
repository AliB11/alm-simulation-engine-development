import type { Behavior, Currency, DepositSchedule, GlobalConfig, MonthRow, Tier } from '../types';

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

function sanitizeTiers(v: unknown): Tier[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Tier[] = [];
  v.forEach((t, i) => {
    if (!isObj(t)) return;
    out.push({
      id: typeof t.id === 'string' ? t.id : `t${i}-${Date.now()}`,
      name: typeof t.name === 'string' ? t.name : `پله ${i + 1}`,
      tDep: Number(t.tDep) || 1,
      tLoan: Number(t.tLoan) || 12,
      alpha: Number(t.alpha) || 100,
      minBalance: Number(t.minBalance) || 0,
      allocation: Number(t.allocation) || 0,
      rateOverride: t.rateOverride === null || t.rateOverride === undefined ? null : Number(t.rateOverride),
    });
  });
  return out;
}

export function sanitizeState(raw: unknown): Partial<PersistedState> | null {
  if (!isObj(raw)) return null;
  const out: Partial<PersistedState> = {};
  if (isObj(raw.config)) out.config = raw.config as unknown as GlobalConfig;
  if (isObj(raw.behavior)) out.behavior = raw.behavior as unknown as Behavior;
  if (isObj(raw.schedule)) out.schedule = raw.schedule as unknown as DepositSchedule;
  const tiers = sanitizeTiers(raw.tiers);
  if (tiers) out.tiers = tiers;
  if (typeof raw.activePreset === 'string' || raw.activePreset === null) out.activePreset = raw.activePreset as string | null;
  if (raw.currency === 'toman' || raw.currency === 'rial') out.currency = raw.currency;
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

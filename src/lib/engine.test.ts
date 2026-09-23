import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Behavior, DepositSchedule, GlobalConfig, SimInput, Tier } from '../types';
import { applySensitivity, buildVintages, runSensitivity, simulate } from './engine';
import { sanitizeState } from './io';

const config: GlobalConfig = {
  contractType: 'qard',
  qardFeeRate: 4,
  murabahaRate: 21,
  reserveRatio: 0,
  loanCap: 0,
  horizon: 12,
  initialLiquidity: 0,
  releaseReserve: false,
  defaultRate: 0,
  interbankRate: 23,
  opportunityRate: 23,
};

const behavior: Behavior = {
  totalDeposit: 1_000,
  avgTicket: 100,
  takeUpRate: 100,
  approvalRate: 100,
  runoffRate: 0,
  churnRate: 0,
};

const tier: Tier = {
  id: 'tier-1',
  name: 'Test tier',
  tDep: 1,
  tLoan: 6,
  alpha: 100,
  minBalance: 0,
  allocation: 100,
  rateOverride: null,
};

const lump: DepositSchedule = { mode: 'lump', uniformMonths: 1, custom: [] };
const input: SimInput = { config, behavior, tiers: [tier], schedule: lump };

const expectClose = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= 1e-8, `expected ${actual} to be close to ${expected}`);

describe('ALM simulation issue regressions', () => {
  it('does not issue loans to customers below a tier minimum balance', () => {
    const ineligible = simulate({
      ...input,
      tiers: [{ ...tier, minBalance: 200 }],
    });
    assert.equal(ineligible.tiers[0].commitment, 0);
    assert.equal(ineligible.tiers[0].monthlyPmt, 0);

    const eligible = simulate({
      ...input,
      behavior: { ...behavior, avgTicket: 200 },
      tiers: [{ ...tier, minBalance: 200 }],
    });
    assert.equal(eligible.tiers[0].commitment, 1_000);
  });

  it('keeps uncollected principal on the loan book when defaults are modeled', () => {
    const result = simulate({
      ...input,
      config: { ...config, defaultRate: 100 },
      tiers: [{ ...tier, tLoan: 2 }],
    });
    assert.equal(result.rows[1].loanBook, 1_000);
    assert.equal(result.rows[2].pmtInflow, 0);
    assert.equal(result.rows[2].loanBook, 1_000);
  });

  it('preserves tier rate overrides at the current rate in sensitivity scenarios', () => {
    const overridden: SimInput = {
      ...input,
      tiers: [{ ...tier, rateOverride: 2 }],
    };
    const currentScenario = applySensitivity(overridden, 'rate', 4);
    assert.equal(currentScenario.tiers[0].rateOverride, 2);

    const grid = runSensitivity(overridden, 'rate', 'takeUpRate');
    const currentCell = grid.cells[grid.yi][grid.xi];
    expectClose(currentCell.totalIncomeInHorizon, simulate(overridden, false).kpis.totalIncomeInHorizon);
  });

  it('renormalizes custom schedules after omitting out-of-horizon entries', () => {
    const vintages = buildVintages(
      100,
      {
        mode: 'custom',
        uniformMonths: 1,
        custom: [
          { id: 'in', month: 0, share: 50 },
          { id: 'out', month: 20, share: 50 },
        ],
      },
      12,
    );
    assert.deepEqual(vintages, [{ month: 0, amount: 100 }]);
  });

  it('normalizes malformed imported schedules into a render-safe shape', () => {
    const sanitized = sanitizeState({ schedule: { mode: 'custom' } });
    assert.deepEqual(sanitized?.schedule, { mode: 'custom', uniformMonths: 12, custom: [] });
    assert.doesNotThrow(() =>
      simulate({
        ...input,
        schedule: sanitized!.schedule!,
      }),
    );
  });
});

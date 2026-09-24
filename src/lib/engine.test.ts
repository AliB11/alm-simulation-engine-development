import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Behavior, DepositSchedule, GlobalConfig, SimInput, Tier } from '../types';
import { amortization, applySensitivity, buildVintages, calcPmt, runSensitivity, simulate, uniformVintageCount } from './engine';
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
  depositProfitRate: 0,
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

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

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

describe('ALM engine robustness and internal consistency', () => {
  it('never lets a non-finite tier field poison the cash-flow matrix', () => {
    const broken: SimInput[] = [
      { ...input, tiers: [{ ...tier, alpha: NaN }] },
      { ...input, tiers: [{ ...tier, alpha: undefined as unknown as number }] },
      { ...input, tiers: [{ ...tier, tDep: NaN }] },
      { ...input, tiers: [{ ...tier, tLoan: NaN, minBalance: NaN, allocation: NaN }] },
      { ...input, tiers: [{ ...tier, rateOverride: NaN }] },
      { ...input, config: { ...config, interbankRate: NaN, initialLiquidity: NaN, reserveRatio: NaN }, behavior: { ...behavior, avgTicket: NaN } },
      { ...input, behavior: { ...behavior, totalDeposit: NaN, takeUpRate: NaN, churnRate: NaN } },
    ];
    for (const scenario of broken) {
      const result = simulate(scenario);
      for (const row of result.rows) {
        assert.ok(Number.isFinite(row.cum), `cum must stay finite, got ${row.cum}`);
        assert.ok(Number.isFinite(row.ncf), `ncf must stay finite, got ${row.ncf}`);
        assert.ok(Number.isFinite(row.depositBalance) && Number.isFinite(row.loanBook));
      }
      assert.ok(Number.isFinite(result.kpis.endCum), 'endCum must stay finite');
      assert.ok(Number.isFinite(result.kpis.minCum), 'minCum must stay finite');
      assert.ok(Number.isFinite(result.kpis.interbankCost), 'interbankCost must stay finite');
      assert.ok(
        result.tiers.every((t) => Number.isFinite(t.commitment) && Number.isFinite(t.withdrawal)),
        'tier results must stay finite',
      );
      assert.ok(
        result.tiers.every((t) => t.firstMaturity === null || Number.isFinite(t.firstMaturity)),
        'maturity months must never be NaN (UI renders them as "ماه NaN")',
      );
    }
  });

  it('reports no borrowers for a tier that grants no loan', () => {
    const result = simulate({
      ...input,
      behavior: { ...behavior, avgTicket: 1_000_000 },
      tiers: [{ ...tier, minBalance: 50_000_000 }],
    });
    assert.equal(result.kpis.totalCommitment, 0);
    assert.equal(result.kpis.borrowers, 0, 'a zero-commitment scenario must not advertise borrowers');
    assert.equal(result.tiers[0].lends, false);

    const zeroAlpha = simulate({ ...input, tiers: [{ ...tier, alpha: 0 }] });
    assert.equal(zeroAlpha.kpis.totalCommitment, 0);
    assert.equal(zeroAlpha.kpis.borrowers, 0);
  });

  it('uses churn-only runoff when a tier cannot lend, and the base formula when it can', () => {
    const behavioral: Behavior = { ...behavior, takeUpRate: 80, runoffRate: 90, churnRate: 10 };
    const base = 0.8 * 0.9 + 0.2 * 0.1;

    const lending = simulate({ ...input, behavior: behavioral });
    expectClose(lending.tiers[0].withdrawal, 1_000 * base);

    const notEligible = simulate({
      ...input,
      behavior: { ...behavioral, avgTicket: 1 },
      tiers: [{ ...tier, minBalance: 500 }],
    });
    assert.equal(notEligible.tiers[0].commitment, 0);
    expectClose(notEligible.tiers[0].withdrawal, 1_000 * 0.1);

    const noAlpha = simulate({ ...input, behavior: behavioral, tiers: [{ ...tier, alpha: 0 }] });
    expectClose(noAlpha.tiers[0].withdrawal, 1_000 * 0.1);
  });

  it('reports infinite leverage instead of a reassuring zero when net resources vanish', () => {
    const squeezed = simulate({ ...input, config: { ...config, reserveRatio: 100 } });
    assert.equal(squeezed.kpis.netDeposit, 0);
    assert.ok(squeezed.kpis.totalCommitment + squeezed.kpis.totalWithdrawal > 0);
    assert.equal(squeezed.kpis.leverage, Infinity);

    const idle = simulate({ ...input, behavior: { ...behavior, totalDeposit: 0 } });
    assert.equal(idle.kpis.leverage, 0);

    const normal = simulate(input);
    assert.ok(Number.isFinite(normal.kpis.leverage) && normal.kpis.leverage > 0);
  });

  it('closes the loan book exactly once every installment is collected', () => {
    const closed = simulate({ ...input, config: { ...config, horizon: 12 }, tiers: [{ ...tier, tDep: 1, tLoan: 6 }] });
    assert.equal(closed.rows[12].loanBook, 0);
    const principal = closed.rows.reduce((s, r) => s + r.principalIn, 0);
    expectClose(principal, closed.kpis.totalCommitment);

    // and the same at extreme rate/term corners where float drift is largest
    const steep = simulate({
      ...input,
      config: { ...config, contractType: 'murabaha', murabahaRate: 45, horizon: 120 },
      tiers: [{ ...tier, tDep: 1, tLoan: 60 }],
    });
    assert.ok(steep.rows[120].loanBook < 1e-6, `loan book should close, got ${steep.rows[120].loanBook}`);
  });

  it('keeps payment math finite for non-finite and extreme arguments', () => {
    assert.equal(calcPmt('qard', NaN, 12, 4), 0);
    assert.equal(calcPmt('murabaha', 100, 12, NaN), 100 / 12);
    assert.equal(calcPmt('murabaha', 100, NaN, 4), 0);
    assert.ok(Number.isFinite(calcPmt('murabaha', 1e6, 600, 1000)));
    assert.ok(Number.isFinite(amortization('murabaha', 1e6, 600, 1000).reduce((s, r) => s + r.payment, 0)));
    const unit = amortization('murabaha', 1_000_000, 60, 21);
    expectClose(unit.reduce((s, r) => s + r.principal, 0), 1_000_000);
    expectClose(unit.reduce((s, r) => s + r.income, 0), unit.reduce((s, r) => s + r.payment, 0) - 1_000_000);
  });

  it('exposes one shared rule for the uniform vintage count', () => {
    assert.equal(uniformVintageCount({ mode: 'uniform', uniformMonths: 5, custom: [] }, 12), 5);
    assert.equal(uniformVintageCount({ mode: 'uniform', uniformMonths: 99, custom: [] }, 12), 13);
    assert.equal(uniformVintageCount({ mode: 'uniform', uniformMonths: NaN, custom: [] }, 12), 1);
    assert.equal(buildVintages(1_000, { mode: 'uniform', uniformMonths: 99, custom: [] }, 12).length, 13);
  });
});

describe('deposit profit and simulated P&L', () => {
  const pAndL: SimInput = {
    config: { ...config, reserveRatio: 0, horizon: 12, interbankRate: 0, defaultRate: 0 },
    behavior,
    tiers: [{ ...tier, tDep: 3, tLoan: 6 }],
    schedule: lump,
  };

  it('stays completely neutral at the default zero rate', () => {
    const result = simulate(pAndL);
    assert.equal(result.kpis.totalProfitPaid, 0);
    assert.ok(result.rows.every((r) => r.profitPaid === 0));
    assert.equal(result.kpis.netInterestIncome, result.kpis.totalIncomeInHorizon);
    assert.equal(result.kpis.netMargin, result.kpis.totalIncomeInHorizon - result.kpis.interbankCost);
    assert.ok(result.rows.every((r) => near(r.outflow, r.loanOut + r.withdrawalOut)));
  });

  it('accrues profit on the closing deposit balance of each month', () => {
    const rate = 20;
    const result = simulate({ ...pAndL, config: { ...pAndL.config, depositProfitRate: rate } });
    const monthly = rate / 1200;
    for (const r of result.rows) assert.ok(Math.abs(r.profitPaid - r.depositBalance * monthly) < 1e-6);

    // closed form: months 0..tDep-1 carry the full deposit, tDep..H the post-runoff balance
    const D = behavior.totalDeposit;
    const tDep = 3;
    const H = 12;
    const wd = result.kpis.totalWithdrawal;
    const expected = monthly * (tDep * D + (H + 1 - tDep) * (D - wd));
    expectClose(result.kpis.totalProfitPaid, expected);
  });

  it('keeps the P&L identity and cumulative margin consistent month by month', () => {
    const result = simulate({ ...pAndL, config: { ...pAndL.config, depositProfitRate: 18, interbankRate: 23 } });
    let margin = 0;
    for (const r of result.rows) {
      margin += r.incomeIn - r.profitPaid - r.fundingCost;
      assert.ok(Math.abs(r.cumMargin - margin) < 1e-6, `cumMargin drifted at month ${r.t}`);
    }
    expectClose(result.kpis.netInterestIncome, result.kpis.totalIncomeInHorizon - result.kpis.totalProfitPaid);
    expectClose(result.kpis.netMargin, margin);
    expectClose(result.kpis.interbankCost, result.rows.reduce((s, r) => s + r.fundingCost, 0));
  });

  it('feeds deposit profit into liquidity risk, not just the P&L', () => {
    const neutral = simulate(pAndL).kpis;
    const paying = simulate({ ...pAndL, config: { ...pAndL.config, depositProfitRate: 25 } }).kpis;
    assert.ok(paying.endCum < neutral.endCum, 'paying deposit profit must reduce cumulative liquidity');
    assert.ok(paying.maxHole >= neutral.maxHole);
    assert.ok(paying.totalProfitPaid > 0);
    assert.ok(
      (paying.tippingPoint ?? Infinity) <= (neutral.tippingPoint ?? Infinity),
      'the tipping point cannot move later when an extra outflow is added',
    );
  });

  it('exposes the deposit rate as a sensitivity axis and keeps the current cell identical', () => {
    const input: SimInput = { ...pAndL, config: { ...pAndL.config, depositProfitRate: 18 } };
    const shocked = applySensitivity(input, 'profitRate', 25);
    assert.equal(shocked.config.depositProfitRate, 25);
    assert.equal(input.config.depositProfitRate, 18, 'applySensitivity must not mutate its input');

    const grid = runSensitivity(input, 'profitRate', 'takeUpRate');
    assert.ok(grid.xs.includes(18));
    const cell = grid.cells[grid.yi][grid.xi];
    const ref = simulate(input, false).kpis;
    expectClose(cell.netMargin, ref.netMargin);
    expectClose(cell.maxHole, ref.maxHole);
    assert.ok(grid.cells.every((row) => row.every((c) => Number.isFinite(c.netMargin))));
  });

  it('ignores a malformed deposit rate instead of poisoning the matrix', () => {
    const result = simulate({ ...pAndL, config: { ...pAndL.config, depositProfitRate: NaN } });
    assert.equal(result.kpis.totalProfitPaid, 0);
    assert.ok(result.rows.every((r) => Number.isFinite(r.cum) && Number.isFinite(r.cumMargin)));
    assert.ok(Number.isFinite(result.kpis.netMargin) && Number.isFinite(result.kpis.marginOnNetDeposit));
  });
});

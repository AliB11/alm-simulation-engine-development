import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Behavior, DepositSchedule, GlobalConfig, SimInput, Tier } from '../types';
import { amortization, applySensitivity, buildVintages, calcPmt, estimateTierOffer, runSensitivity, SENS_VARS, simulate, uniformVintageCount } from './engine';
import { sanitizeState } from './io';
import { presetInput } from './testUtils';

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
  lgdRate: 100,
  writeOffLag: 12,
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

describe('customer loan estimate', () => {
  const fourMonthTier: Tier = {
    ...tier,
    name: 'حالت سوم',
    tDep: 4,
    tLoan: 12,
    alpha: 110,
    minBalance: 1_000_000,
  };

  it('estimates the shipped 4-month / 12-installment example with the configured Qard formula', () => {
    const sample = presetInput('sample-2');
    const exampleTier = sample.tiers.find((candidate) => candidate.tDep === 4 && candidate.tLoan === 12);
    assert.ok(exampleTier, 'the default sample must include a 4-month / 12-installment option');
    const offer = estimateTierOffer(exampleTier, sample.config, 100_000_000);
    assert.equal(offer.eligible, true);
    assert.equal(offer.loan, 110_000_000);
    assert.equal(offer.capped, false);
    expectClose(offer.monthlyPayment, calcPmt('qard', 110_000_000, 12, 4));
    assert.ok(Math.abs(offer.totalRepayment - 114_400_000) < 1e-6);
    assert.ok(Math.abs(offer.totalCharge - 4_400_000) < 1e-6);
  });

  it('applies the individual loan cap after calculating the raw eligible amount', () => {
    const capped = estimateTierOffer(fourMonthTier, { ...config, loanCap: 100_000_000 }, 100_000_000);
    assert.equal(capped.rawLoan, 110_000_000);
    assert.equal(capped.loan, 100_000_000);
    assert.equal(capped.capped, true);
    expectClose(capped.monthlyPayment, calcPmt('qard', 100_000_000, 12, 4));
  });

  it('does not estimate a loan when the customer is below the tier minimum balance', () => {
    const offer = estimateTierOffer(fourMonthTier, config, 500_000);
    assert.equal(offer.eligible, false);
    assert.equal(offer.loan, 0);
    assert.equal(offer.monthlyPayment, 0);
  });

  it('uses the annuity formula for a Murabaha offer', () => {
    const murabaha = estimateTierOffer(
      fourMonthTier,
      { ...config, contractType: 'murabaha', murabahaRate: 21 },
      100_000_000,
    );
    expectClose(murabaha.monthlyPayment, calcPmt('murabaha', 110_000_000, 12, 21));
  });
});

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

  it('reports a signed infinite margin ratio instead of a reassuring zero', () => {
    // RR = ۱۰۰٪ ⇒ منابع ورودی خالص صفر است، اما طرح همچنان زیان می‌سازد
    const squeezed = simulate({ ...input, config: { ...config, reserveRatio: 100 } });
    assert.equal(squeezed.kpis.netDeposit, 0);
    assert.ok(squeezed.kpis.netMargin < 0, `expected a loss, got ${squeezed.kpis.netMargin}`);
    assert.equal(
      squeezed.kpis.marginOnNetDeposit,
      -Infinity,
      'a losing design with no net resources must not read as break-even (0%)',
    );

    // همین حالت اما با حاشیهٔ مثبت: بی‌نهایت باید علامت مثبت داشته باشد
    const profitable = simulate({
      ...input,
      config: { ...config, reserveRatio: 100, interbankRate: 0 },
      behavior: { ...behavior, runoffRate: 0, churnRate: 0 },
    });
    assert.equal(profitable.kpis.netDeposit, 0);
    assert.ok(profitable.kpis.netMargin > 0);
    assert.equal(profitable.kpis.marginOnNetDeposit, Infinity);

    // بدون منابع و بدون جریان، نسبت واقعاً تعریف‌نشده و خنثی است
    const idle = simulate({ ...input, behavior: { ...behavior, totalDeposit: 0 } });
    assert.equal(idle.kpis.marginOnNetDeposit, 0);
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

  it('accrues profit on the average monthly balance of each month', () => {
    const rate = 20;
    const result = simulate({ ...pAndL, config: { ...pAndL.config, depositProfitRate: rate } });
    const monthly = rate / 1200;
    let prev = 0;
    for (const r of result.rows) {
      const avg = (prev + r.depositBalance) / 2;
      assert.ok(Math.abs(r.profitPaid - avg * monthly) < 1e-6, `profit mismatch at month ${r.t}`);
      prev = r.depositBalance;
    }

    // closed form with no runoff: month 0 averages D/2, months 1..H the full D
    const D = behavior.totalDeposit;
    const H = 12;
    expectClose(result.kpis.totalProfitPaid, monthly * (D / 2 + H * D));
  });

  it('averages deposits and withdrawals that land inside the month', () => {
    const rate = 20;
    const full = simulate({
      ...pAndL,
      behavior: { ...pAndL.behavior, runoffRate: 100, churnRate: 100 },
      config: { ...pAndL.config, depositProfitRate: rate },
    });
    // D = ۱۰۰۰ در ماه صفر می‌نشیند و در ماه ۳ به‌طور کامل خارج می‌شود:
    // میانگین‌ها: ۵۰۰، ۱۰۰۰، ۱۰۰۰، ۵۰۰ و سپس صفر
    const monthly = rate / 1200;
    expectClose(full.rows[0].profitPaid, 500 * monthly);
    expectClose(full.rows[1].profitPaid, 1000 * monthly);
    expectClose(full.rows[3].profitPaid, 500 * monthly);
    expectClose(full.rows[4].profitPaid, 0);
    expectClose(full.kpis.totalProfitPaid, monthly * 3000);
  });

  it('keeps the P&L identity and cumulative margin consistent month by month', () => {
    const result = simulate({
      ...pAndL,
      config: { ...pAndL.config, depositProfitRate: 18, interbankRate: 23, defaultRate: 10 },
    });
    let margin = 0;
    for (const r of result.rows) {
      margin += r.incomeIn - r.profitPaid - r.fundingCost - r.provisionCost;
      assert.ok(Math.abs(r.cumMargin - margin) < 1e-6, `cumMargin drifted at month ${r.t}`);
    }
    expectClose(result.kpis.netInterestIncome, result.kpis.totalIncomeInHorizon - result.kpis.totalProfitPaid);
    expectClose(result.kpis.netMargin, margin);
    expectClose(result.kpis.interbankCost, result.rows.reduce((s, r) => s + r.fundingCost, 0));
    expectClose(result.kpis.totalProvision, result.rows.reduce((s, r) => s + r.provisionCost, 0));
    expectClose(result.kpis.totalWriteOff, result.rows.reduce((s, r) => s + r.writeOff, 0));
    assert.ok(result.kpis.totalProvision > 0, 'a 10% default rate must produce a provision');
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

describe('loan-loss provisioning and write-off', () => {
  const npl: SimInput = {
    config: { ...config, reserveRatio: 0, horizon: 12, interbankRate: 0, defaultRate: 50, lgdRate: 100, writeOffLag: 2 },
    behavior,
    tiers: [{ ...tier, tDep: 3, tLoan: 6 }],
    schedule: lump,
  };
  // D = ۱۰۰۰، α = ۱۰۰٪، تقاضا و قبولی ۱۰۰٪ ⇒ L = ۱۰۰۰ در ماه ۳؛ زیان موردانتظار = ۱۰۰۰ × ۵۰٪ × ۱۰۰٪ = ۵۰۰

  it('recognizes the expected-loss provision at disbursement', () => {
    const result = simulate(npl);
    expectClose(result.rows[3].provisionCost, 500);
    assert.ok(result.rows.every((r, i) => (i === 3 ? true : r.provisionCost === 0)));
    expectClose(result.kpis.totalProvision, 500);
  });

  it('writes uncollected principal off the loan book after the last installment plus lag', () => {
    const result = simulate(npl);
    // اقساط ماه‌های ۴ تا ۹؛ سوخت در ۳ + ۶ + ۲ = ماه ۱۱
    expectClose(result.rows[11].writeOff, 500);
    expectClose(result.kpis.totalWriteOff, 500);
    expectClose(result.rows[9].loanBook, 500);
    assert.ok(result.rows[9].loanBook > 0, 'uncollected principal stays on the book until write-off');
    expectClose(result.rows[11].loanBook, 0);
    expectClose(result.rows[12].loanBook, 0);
  });

  it('keeps provisions and write-offs out of liquidity while charging them to the margin', () => {
    const full = simulate(npl);
    const noLgd = simulate({ ...npl, config: { ...npl.config, lgdRate: 0 } });
    assert.equal(noLgd.kpis.totalProvision, 0);
    assert.equal(noLgd.kpis.totalWriteOff, 0);
    expectClose(noLgd.rows[12].loanBook, 500);
    assert.equal(full.kpis.endCum, noLgd.kpis.endCum, 'provisions are non-cash and must not move liquidity');
    assert.equal(full.kpis.maxHole, noLgd.kpis.maxHole);
    expectClose(noLgd.kpis.netMargin - full.kpis.netMargin, 500);
    expectClose(full.kpis.netMargin, full.kpis.netInterestIncome - full.kpis.interbankCost - full.kpis.totalProvision);
  });

  it('leaves the recoverable share of uncollected principal on the book under partial LGD', () => {
    const result = simulate({ ...npl, config: { ...npl.config, lgdRate: 40 } });
    expectClose(result.kpis.totalProvision, 200);
    expectClose(result.kpis.totalWriteOff, 200);
    expectClose(result.rows[12].loanBook, 300);
  });

  it('stays neutral when there is no default, regardless of LGD and lag', () => {
    const result = simulate({ ...npl, config: { ...npl.config, defaultRate: 0 } });
    assert.equal(result.kpis.totalProvision, 0);
    assert.equal(result.kpis.totalWriteOff, 0);
    assert.ok(result.rows.every((r) => r.provisionCost === 0 && r.writeOff === 0));
  });
});

describe('sensitivity — default rate driver', () => {
  it('exposes the default rate as a bounded sensitivity variable', () => {
    const def = SENS_VARS.find((v) => v.key === 'defaultRate');
    assert.ok(def, 'defaultRate must be a sensitivity variable');
    assert.deepEqual(def!.values(presetInput('sample-2')), [0, 2, 5, 10, 15, 25, 40]);
    const shocked = applySensitivity(presetInput('sample-2'), 'defaultRate', 25);
    assert.equal(shocked.config.defaultRate, 25);
    assert.equal(shocked.behavior.takeUpRate, presetInput('sample-2').behavior.takeUpRate);
    const clamped = applySensitivity(presetInput('sample-2'), 'defaultRate', 400);
    assert.equal(clamped.config.defaultRate, 100);
  });

  it('moves the hole and provision when the default grid is swept', () => {
    const input = presetInput('sample-2');
    const grid = runSensitivity(input, 'defaultRate', 'takeUpRate');
    assert.ok(grid.xs.includes(0));
    const lo = grid.cells[0][0];
    const hi = grid.cells[0][grid.cells[0].length - 1];
    assert.ok(hi.totalProvision >= lo.totalProvision);
    assert.ok(hi.totalPmtInHorizon <= lo.totalPmtInHorizon + 1e-6);
  });
});

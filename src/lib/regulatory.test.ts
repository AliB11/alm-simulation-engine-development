import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RegulatoryParams } from './regulatory';
import { computeRegulatory, DEFAULT_REGULATORY } from './regulatory';
import { bucketLabel, bucketSizeFor, horizonOf } from './buckets';
import { tierAttribution } from './attribution';
import { tierColor } from './presets';
import { EPS, simulate } from './engine';
import { near, presetInput } from './testUtils';

const sampleOne = presetInput('sample-1');
const secondSample = presetInput('sample-3');
const sampleOneResult = simulate(sampleOne, true);
const secondSampleResult = simulate(secondSample, true);

describe('regulatory metrics — bucketing', () => {
  it('chooses a readable bucket size for every horizon', () => {
    assert.equal(bucketSizeFor(12), 1);
    assert.equal(bucketSizeFor(24), 1);
    assert.equal(bucketSizeFor(25), 3);
    assert.equal(bucketSizeFor(60), 3);
    assert.equal(bucketSizeFor(61), 6);
    assert.equal(bucketSizeFor(180), 6);
    assert.equal(bucketSizeFor(181), 12);
    assert.equal(bucketSizeFor(600), 12);
    // ورودی نامعتبر به افق پیش‌فرض بازمی‌گردد
    assert.equal(bucketSizeFor(NaN), 3);
  });

  it('partitions the horizon exactly once', () => {
    const reg = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    const H = sampleOneResult.rows.length;
    // اندازهٔ سطل از «افق» (آخرین ماه) گرفته می‌شود، نه از تعداد ردیف‌ها
    assert.equal(reg.bucketSize, bucketSizeFor(horizonOf(sampleOneResult.rows)));
    assert.equal(horizonOf(sampleOneResult.rows), H - 1);
    const firstMonth = sampleOneResult.rows[0].t;
    const lastMonth = sampleOneResult.rows[H - 1].t;
    let covered = 0;
    for (let i = 0; i < reg.buckets.length; i++) {
      const b = reg.buckets[i];
      covered += b.to - b.from + 1;
      assert.equal(b.from, i === 0 ? firstMonth : reg.buckets[i - 1].to + 1);
      assert.ok(b.to <= lastMonth);
      assert.ok(b.to >= b.from);
      assert.equal(b.label, bucketLabel(b.from, b.to));
    }
    assert.equal(covered, H, 'buckets must cover every month exactly once');
  });

  it('returns empty structures without crashing when there are no rows', () => {
    const reg = computeRegulatory([], DEFAULT_REGULATORY);
    assert.deepEqual(reg.lcr, []);
    assert.deepEqual(reg.buckets, []);
    assert.equal(reg.minLcr, null);
    assert.equal(reg.minLcrMonth, null);
    assert.equal(reg.nsfr, null);
    assert.equal(reg.walAssets, null);
    assert.equal(reg.maturityGap, null);
    assert.equal(reg.recoveryRate, null);
    assert.equal(reg.monthsBelow100, 0);
  });
});

describe('regulatory metrics — LCR proxy', () => {
  it('matches the documented formula month by month', () => {
    const params: RegulatoryParams = {
      stressRunoff: 10,
      stableWeight: 90,
      loanWeight: 85,
      wholesaleShare: 0,
      wholesaleRunoff: 25,
      hqlaHaircut: 0,
    };
    const reg = computeRegulatory(sampleOneResult.rows, params);
    assert.equal(reg.lcr.length, sampleOneResult.rows.length);
    sampleOneResult.rows.forEach((row, i) => {
      const p = reg.lcr[i];
      assert.equal(p.month, row.t);
      assert.equal(p.hqla, Math.max(0, row.cum));
      assert.ok(near(p.outflow, Math.max(0, row.outflow) + (row.depositBalance * params.stressRunoff) / 100, 1e-12));
      if (p.outflow > EPS) {
        assert.ok(near(p.lcr!, (p.hqla / p.outflow) * 100, 1e-12));
      } else {
        assert.equal(p.lcr, null, 'a month without outflow has unbounded coverage');
      }
    });
  });

  it('never improves when the stress runoff is raised', () => {
    const calm = computeRegulatory(sampleOneResult.rows, { ...DEFAULT_REGULATORY, stressRunoff: 0 });
    const stressed = computeRegulatory(sampleOneResult.rows, { ...DEFAULT_REGULATORY, stressRunoff: 20 });
    calm.lcr.forEach((p, i) => {
      const q = stressed.lcr[i];
      if (p.lcr !== null && q.lcr !== null) assert.ok(q.lcr <= p.lcr + 1e-9);
      // ماهی که در حالت آرام خروج خالص ندارد، با افزودن خروج استرس قابل سنجش می‌شود
      if (p.lcr === null && q.lcr !== null) assert.ok(q.outflow > EPS && q.hqla >= 0);
      assert.ok(q.outflow >= p.outflow - 1e-9);
    });
    assert.ok(stressed.monthsBelow100 >= calm.monthsBelow100);
    assert.ok((stressed.minLcr ?? Infinity) <= (calm.minLcr ?? Infinity) + 1e-9);
  });

  it('reports the binding month and the count of months below 100%', () => {
    const reg = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    const measured = reg.lcr.filter((p) => p.lcr !== null) as { month: number; lcr: number }[];
    assert.ok(measured.length > 0);
    const worst = measured.reduce((a, b) => (b.lcr < a.lcr ? b : a));
    assert.ok(near(reg.minLcr!, worst.lcr, 1e-12));
    assert.equal(reg.minLcrMonth, worst.month);
    assert.equal(reg.monthsBelow100, measured.filter((p) => p.lcr < 100).length);
  });

  it('clamps nonsensical parameters instead of producing NaN', () => {
    const reg = computeRegulatory(sampleOneResult.rows, {
      stressRunoff: NaN,
      stableWeight: -50,
      loanWeight: 1e9,
      wholesaleShare: NaN,
      wholesaleRunoff: -10,
      hqlaHaircut: 1e9,
    });
    for (const p of reg.lcr) {
      assert.ok(p.lcr === null || Number.isFinite(p.lcr));
      assert.ok(Number.isFinite(p.outflow) && p.outflow >= 0);
    }
    assert.ok(reg.nsfr === null || Number.isFinite(reg.nsfr));
  });
});

describe('regulatory metrics — NSFR proxy and maturity gap', () => {
  it('uses month 12 when the horizon allows it and the last month otherwise', () => {
    const reg = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    assert.equal(reg.nsfrMonth, 12);
    const row = sampleOneResult.rows.find((r) => r.t === 12)!;
    assert.ok(near(reg.asf, (row.depositBalance * DEFAULT_REGULATORY.stableWeight) / 100, 1e-12));
    assert.ok(near(reg.rsf, (row.loanBook * DEFAULT_REGULATORY.loanWeight) / 100, 1e-12));
    assert.ok(near(reg.nsfr!, (reg.asf / reg.rsf) * 100, 1e-12));

    const short = simulate({ ...sampleOne, config: { ...sampleOne.config, horizon: 6 } }, false);
    const regShort = computeRegulatory(short.rows, DEFAULT_REGULATORY);
    assert.equal(regShort.nsfrMonth, 6);
    assert.equal(regShort.nsfrMonth, short.rows[short.rows.length - 1].t);
  });

  it('scales linearly with the stability and illiquidity weights', () => {
    const base = computeRegulatory(sampleOneResult.rows, {
      stressRunoff: 5,
      stableWeight: 90,
      loanWeight: 85,
      wholesaleShare: 0,
      wholesaleRunoff: 25,
      hqlaHaircut: 0,
    });
    const doubleStable = computeRegulatory(sampleOneResult.rows, {
      stressRunoff: 5,
      stableWeight: 90,
      loanWeight: 42.5,
      wholesaleShare: 0,
      wholesaleRunoff: 25,
      hqlaHaircut: 0,
    });
    // نصف‌شدن ضریب RSF باید NSFR را دو برابر کند
    assert.ok(near(doubleStable.nsfr!, base.nsfr! * 2, 1e-9));
    const zeroWeight = computeRegulatory(sampleOneResult.rows, {
      stressRunoff: 5,
      stableWeight: 0,
      loanWeight: 85,
      wholesaleShare: 0,
      wholesaleRunoff: 25,
      hqlaHaircut: 0,
    });
    assert.equal(zeroWeight.nsfr, 0);
    const zeroRsf = computeRegulatory(sampleOneResult.rows, {
      stressRunoff: 5,
      stableWeight: 90,
      loanWeight: 0,
      wholesaleShare: 0,
      wholesaleRunoff: 25,
      hqlaHaircut: 0,
    });
    assert.equal(zeroRsf.nsfr, null, 'division by zero RSF must stay undefined');
  });

  it('computes WAL from the actual principal and liability-outflow profiles', () => {
    const reg = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    const H = sampleOneResult.rows.length;
    let wIn = 0;
    let tIn = 0;
    let wOut = 0;
    let tOut = 0;
    for (const row of sampleOneResult.rows) {
      wIn += row.t * Math.max(0, row.principalIn);
      tIn += Math.max(0, row.principalIn);
      // سمت تعهد همان خروجی نردبان است: برداشت اصل + سود پرداختی سپرده
      const liabilityOutflow = Math.max(0, row.withdrawalOut) + Math.max(0, row.profitPaid);
      wOut += row.t * liabilityOutflow;
      tOut += liabilityOutflow;
    }
    const lastRow = sampleOneResult.rows[H - 1];
    const surviving = lastRow.depositBalance;
    wOut += lastRow.t * surviving;
    tOut += surviving;
    assert.ok(near(reg.walAssets!, wIn / tIn, 1e-9));
    assert.ok(near(reg.walLiabilities!, wOut / tOut, 1e-9));
    assert.ok(near(reg.maturityGap!, reg.walAssets! - reg.walLiabilities!, 1e-12));
    assert.ok(reg.walAssets! >= 0 && reg.walAssets! <= lastRow.t);
    assert.ok(reg.walLiabilities! >= 0 && reg.walLiabilities! <= lastRow.t);
    assert.ok(near(reg.depositSurvival, surviving, 1e-12));
  });

  it('weights deposit profit into the liability WAL, like the ladder does', () => {
    const paying = computeRegulatory(secondSampleResult.rows, DEFAULT_REGULATORY);
    const profit = secondSampleResult.rows.reduce((s, r) => s + Math.max(0, r.profitPaid), 0);
    assert.ok(profit > 0, 'secondSample pays deposit profit');

    let wOut = 0;
    let tOut = 0;
    for (const row of secondSampleResult.rows) {
      const outflow = Math.max(0, row.withdrawalOut) + Math.max(0, row.profitPaid);
      wOut += row.t * outflow;
      tOut += outflow;
    }
    const last = secondSampleResult.rows[secondSampleResult.rows.length - 1];
    wOut += last.t * last.depositBalance;
    tOut += last.depositBalance;
    assert.ok(near(paying.walLiabilities!, wOut / tOut, 1e-9));

    // اگر سود سپرده کنار گذاشته شود، عمر تعهدات کوتاه‌تر و شکاف سررسید بزرگ‌تر می‌شود
    let wWd = 0;
    let tWd = 0;
    for (const row of secondSampleResult.rows) {
      wWd += row.t * Math.max(0, row.withdrawalOut);
      tWd += Math.max(0, row.withdrawalOut);
    }
    wWd += last.t * last.depositBalance;
    tWd += last.depositBalance;
    assert.ok(paying.walLiabilities! > wWd / tWd, 'ignoring profit understates liability duration');
  });

  it('aggregates the ladder exactly from the cash-flow matrix', () => {
    const reg = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    const inflow = reg.ladder.reduce((s, r) => s + r.inflow, 0);
    const withdrawal = reg.ladder.reduce((s, r) => s + r.withdrawal, 0);
    const profit = reg.ladder.reduce((s, r) => s + r.profit, 0);
    assert.ok(near(inflow, sampleOneResult.rows.reduce((s, r) => s + Math.max(0, r.principalIn), 0), 1e-9));
    assert.ok(near(withdrawal, sampleOneResult.rows.reduce((s, r) => s + Math.max(0, r.withdrawalOut), 0), 1e-9));
    assert.ok(near(profit, sampleOneResult.rows.reduce((s, r) => s + Math.max(0, r.profitPaid), 0), 1e-9));
    assert.equal(profit, 0, 'sampleOne pays no deposit profit at the preset default');

    for (const r of reg.ladder) {
      assert.ok(near(r.outflow, r.withdrawal + r.profit, 1e-12));
      assert.ok(near(r.net, r.inflow - r.outflow, 1e-12));
    }
    const last = reg.ladder[reg.ladder.length - 1];
    assert.ok(near(last.cumNet, reg.ladder.reduce((s, r) => s + r.net, 0), 1e-9));

    const bucketsInflow = reg.buckets.reduce((s, b) => s + b.inflow, 0);
    assert.ok(near(bucketsInflow, inflow, 1e-9), 'bucketed inflows must add up to the ladder total');
    const bucketsOutflow = reg.buckets.reduce((s, b) => s + b.outflow, 0);
    assert.ok(near(bucketsOutflow, withdrawal + profit, 1e-9));

    const disbursed = sampleOneResult.rows.reduce((s, r) => s + r.loanOut, 0);
    assert.ok(near(reg.recoveryRate!, inflow / disbursed, 1e-9));
  });
});

describe('tier attribution — analytic removal of a tier', () => {
  it('explains the whole cumulative liquidity path when every flow is tier-attributed', () => {
    const attr = tierAttribution(sampleOneResult.rows, tierColor);
    assert.ok(attr.tiers.length > 0);
    assert.equal(attr.unattributedProfit, 0);
    // Σ_k [cum(H) − cumWithout_k(H)] = Σ_t ncf_t = cum(H) − initialLiquidity
    const explained = attr.tiers.reduce((s, t) => s + (attr.base.endCum - t.endCumWithout), 0);
    assert.ok(
      near(explained, attr.base.endCum - sampleOne.config.initialLiquidity, 1e-9),
      `attributed ${explained} vs path ${attr.base.endCum - sampleOne.config.initialLiquidity}`,
    );
    for (const t of attr.tiers) {
      assert.equal(t.cumWithout.length, sampleOneResult.rows.length);
      assert.ok(t.maxHoleWithout >= 0);
      assert.ok(Number.isFinite(t.minCumWithout));
      assert.ok(near(t.ncf, attr.base.endCum - t.endCumWithout, 1e-9));
      assert.ok(near(t.holeDelta, t.maxHoleWithout - attr.base.maxHole, 1e-12));
    }
  });

  it('reproduces the engine KPIs for the base case', () => {
    const attr = tierAttribution(sampleOneResult.rows, tierColor);
    const k = sampleOneResult.kpis;
    assert.ok(near(attr.base.maxHole, k.maxHole, 1e-12));
    assert.equal(attr.base.tipping, k.tippingPoint);
    assert.equal(attr.base.minCumMonth, k.minCumMonth);
    assert.ok(near(attr.base.endCum, k.endCum, 1e-12));
  });

  it('splits the portfolio-level deposit profit across tiers by their balances', () => {
    const attr = tierAttribution(secondSampleResult.rows, tierColor);
    const totalProfit = secondSampleResult.rows.reduce((s, r) => s + r.profitPaid, 0);
    assert.ok(totalProfit > 0, 'the secondSample preset pays deposit profit');
    const attributed = attr.tiers.reduce((s, t) => s + t.profit, 0);
    assert.ok(
      near(attributed + attr.unattributedProfit, totalProfit, 1e-9),
      `attributed ${attributed} + unattributed ${attr.unattributedProfit} vs paid ${totalProfit}`,
    );
    assert.equal(attr.unattributedProfit, 0, 'with positive allocations every deposit belongs to a tier');
    for (const t of attr.tiers) assert.ok(t.profit >= 0);
  });

  it('attributes the deposit and loan flows of each tier to that tier only', () => {
    const attr = tierAttribution(sampleOneResult.rows, tierColor);
    const byTier = new Map(attr.tiers.map((t) => [t.tierId, t]));
    let depositTotal = 0;
    let withdrawalTotal = 0;
    let loanTotal = 0;
    let pmtTotal = 0;
    for (const row of sampleOneResult.rows) {
      for (const e of row.events) {
        if (e.tierIndex < 0) continue;
        const t = byTier.get(e.tierId);
        assert.ok(t, `event references unknown tier ${e.tierId}`);
        if (e.type === 'deposit') depositTotal += e.amount;
        if (e.type === 'withdrawal') withdrawalTotal += e.amount;
        if (e.type === 'loan') loanTotal += e.amount;
        if (e.type === 'pmt') pmtTotal += e.amount;
      }
    }
    assert.ok(near(attr.tiers.reduce((s, t) => s + t.deposit, 0), depositTotal, 1e-9));
    assert.ok(near(attr.tiers.reduce((s, t) => s + t.withdrawal, 0), withdrawalTotal, 1e-9));
    assert.ok(near(attr.tiers.reduce((s, t) => s + t.loan, 0), loanTotal, 1e-9));
    assert.ok(near(attr.tiers.reduce((s, t) => s + t.pmt, 0), pmtTotal, 1e-9));
  });

  it('builds a heat matrix that adds up to the tier outflows', () => {
    const attr = tierAttribution(sampleOneResult.rows, tierColor);
    const H = sampleOneResult.rows.length;
    assert.equal(attr.heat.bucketSize, bucketSizeFor(horizonOf(sampleOneResult.rows)));
    // نقشهٔ حرارتی و نردبان سررسید باید روی یک شبکهٔ زمانی باشند
    assert.equal(attr.heat.bucketSize, computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY).bucketSize);
    assert.equal(attr.heat.bucketLabels.length, Math.ceil(H / attr.heat.bucketSize));
    assert.equal(attr.heat.cells.length, attr.tiers.length);
    for (const row of attr.heat.cells) assert.equal(row.length, attr.heat.bucketLabels.length);

    const heatTotal = attr.heat.cells.flat().reduce((s, v) => s + v, 0);
    const withdrawal = attr.tiers.reduce((s, t) => s + t.withdrawal, 0);
    const profit = attr.tiers.reduce((s, t) => s + t.profit, 0);
    assert.ok(near(heatTotal, withdrawal + profit, 1e-9), `heat ${heatTotal} vs outflows ${withdrawal + profit}`);

    const inflowTotal = attr.heat.inflow.reduce((s, v) => s + v, 0);
    assert.ok(near(inflowTotal, sampleOneResult.rows.reduce((s, r) => s + Math.max(0, r.principalIn), 0), 1e-9));
    for (const row of attr.heat.cells) for (const v of row) assert.ok(Number.isFinite(v) && v >= 0);
  });

  it('reports the tipping shift only when it is meaningful', () => {
    const attr = tierAttribution(sampleOneResult.rows, tierColor);
    for (const t of attr.tiers) {
      if (attr.base.tipping === null) {
        assert.equal(t.tippingDelta, null);
      } else if (t.tippingWithout === null) {
        assert.equal(t.tippingDelta, Infinity, 'removing the tier eliminated the tipping point');
      } else {
        assert.equal(t.tippingDelta, t.tippingWithout - attr.base.tipping);
      }
    }
  });

  it('handles an empty matrix and a portfolio with no tier events', () => {
    const empty = tierAttribution([], tierColor);
    assert.deepEqual(empty.tiers, []);
    assert.equal(empty.base.maxHole, 0);
    assert.equal(empty.base.endCum, 0);
    assert.equal(empty.unattributedProfit, 0);

    const unallocated = simulate(
      { ...sampleOne, tiers: sampleOne.tiers.map((t) => ({ ...t, allocation: 0 })) },
      true,
    );
    const attr = tierAttribution(unallocated.rows, tierColor);
    assert.deepEqual(attr.tiers, [], 'deposits without allocation belong to no tier');
    assert.ok(attr.base.maxHole >= 0);
    assert.deepEqual(attr.heat.cells, []);
  });
});

describe('regulatory metrics — wholesale split and HQLA haircut', () => {
  it('reproduces the legacy single-rate LCR at zero wholesale share and haircut', () => {
    const reg = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    assert.equal(reg.effStressRunoff, 5);
    sampleOneResult.rows.forEach((row, i) => {
      const p = reg.lcr[i];
      assert.equal(p.hqla, Math.max(0, row.cum));
      assert.ok(near(p.outflow, Math.max(0, row.outflow) + (row.depositBalance * 5) / 100, 1e-12));
    });
  });

  it('blends retail and wholesale runoff by the wholesale share', () => {
    const reg = computeRegulatory(sampleOneResult.rows, {
      ...DEFAULT_REGULATORY,
      wholesaleShare: 50,
      wholesaleRunoff: 25,
    });
    assert.ok(near(reg.effStressRunoff, 15, 1e-12));
    const row = sampleOneResult.rows[0];
    assert.ok(near(reg.lcr[0].outflow, Math.max(0, row.outflow) + (row.depositBalance * 15) / 100, 1e-9));
    const allWholesale = computeRegulatory(sampleOneResult.rows, {
      ...DEFAULT_REGULATORY,
      wholesaleShare: 100,
      wholesaleRunoff: 25,
    });
    assert.ok(near(allWholesale.effStressRunoff, 25, 1e-12));
  });

  it('never improves LCR when the haircut or the wholesale runoff is raised', () => {
    const base = computeRegulatory(sampleOneResult.rows, DEFAULT_REGULATORY);
    const cut = computeRegulatory(sampleOneResult.rows, { ...DEFAULT_REGULATORY, hqlaHaircut: 20 });
    base.lcr.forEach((p, i) => {
      const q = cut.lcr[i];
      assert.ok(near(q.hqla, p.hqla * 0.8, 1e-9));
      if (p.lcr !== null && q.lcr !== null) assert.ok(q.lcr <= p.lcr + 1e-9);
    });
    assert.ok((cut.minLcr ?? Infinity) <= (base.minLcr ?? Infinity) + 1e-9);
    const stressed = computeRegulatory(sampleOneResult.rows, {
      ...DEFAULT_REGULATORY,
      wholesaleShare: 40,
      wholesaleRunoff: 60,
    });
    stressed.lcr.forEach((p, i) => {
      const q = base.lcr[i];
      assert.ok(p.outflow >= q.outflow - 1e-9);
      if (p.lcr !== null && q.lcr !== null) assert.ok(p.lcr <= q.lcr + 1e-9);
    });
  });
});

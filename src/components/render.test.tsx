import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe as suite, it as test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { Currency } from '../types';
import { DisplayContext } from '../context/display';
import { simulate } from '../lib/engine';
import { presetInput } from '../lib/testUtils';
import { snapshotSlot, SLOT_IDS, type ScenarioSlots } from '../lib/scenarios';
import { computeRegulatory, DEFAULT_REGULATORY } from '../lib/regulatory';
import App from '../App';
import { NAV } from './Header';
import { CashFlowTable } from './CashFlowTable';
import { ScenarioCompare } from './ScenarioCompare';
import { TornadoPanel } from './TornadoPanel';
import { TierComparison } from './TierComparison';
import { MaturityLadder } from './MaturityLadder';
import { RegulatoryPanel } from './RegulatoryPanel';
import { SensitivityPanel } from './SensitivityPanel';
import { tierAttribution } from '../lib/attribution';
import { tierColor } from '../lib/presets';
import { fmtRaw } from '../lib/format';
import { TierBuilder } from './TierBuilder';
import { OptimizerResultTable, OptimizerSummary, resultHeadline } from './OptimizerPanel';
import { DEFAULT_CONSTRAINTS, designTiers, optimizeDesign } from '../lib/optimizer';

/**
 * آزمون دود (smoke) رابط کاربری.
 *
 * این فایل با `react-dom/server` کل درخت کامپوننت‌ها را در نود رندر می‌کند.
 * نمودارهای Recharts در SSR چیزی رسم نمی‌کنند، اما هر محاسبه‌ای که پیش از
 * رسم انجام می‌شود (مقیاس محورها، جدول‌ها، برچسب‌ها، قالب اعداد) اجرا
 * می‌شود. سه کارت کامل — ماتریس گردش نقد، مقایسهٔ سناریوها و جدول مقایسهٔ
 * پله‌ها — یک‌بار نوشته و سپس از چیدمان صفحه جدا شده بودند و هیچ آزمونی
 * آن‌ها را صدا نمی‌زد؛ این فایل همان شکاف را می‌بندد.
 */

const display = (currency: Currency, dark: boolean) => ({
  currency,
  factor: currency === 'rial' ? 10 : 1,
  unit: currency === 'rial' ? 'ریال' : 'تومان',
  dark,
});

const render = (node: ReactNode, currency: Currency = 'toman', dark = false) =>
  renderToStaticMarkup(<DisplayContext.Provider value={display(currency, dark)}>{node}</DisplayContext.Provider>);

/** هیچ عدد خرابی نباید به کاربر نمایش داده شود */
function assertNoBrokenNumbers(html: string, label: string) {
  for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]']) {
    assert.ok(!html.includes(bad), `${label} rendered "${bad}"`);
  }
}

suite('UI smoke — server render of every section', () => {
  test('renders the whole application without throwing or leaking NaN', () => {
    const html = render(<App />);
    assert.ok(html.length > 50_000, `unexpectedly small document: ${html.length}`);
    assertNoBrokenNumbers(html, 'App');
    for (const heading of [
      'تنظیمات کلان محصول',
      'سازنده پویای پله‌های محصول',
      'ورود منابع و داشبورد تعهدات',
      'تحلیل بصری ریسک نقدینگی',
      'آزمون حساسیت و سناریوهای بحران',
      'سنجه‌های مقرراتی‌مانند و نردبان سررسید',
      'مقایسهٔ سناریوها',
      'محاسبه‌گر تسهیلات مشتری',
      'روش‌شناسی و فرمول‌های موتور شبیه‌ساز',
    ]) {
      assert.ok(html.includes(heading), `missing section: ${heading}`);
    }
  });

  test('sample plan three exposes every report rate in an enabled, editable rate field', () => {
    const input = presetInput('sample-3');
    const result = simulate(input, true);
    const html = render(
      <TierBuilder
        tiers={input.tiers}
        results={result.tiers}
        config={input.config}
        activePreset="sample-3"
        onChange={() => {}}
        onLoadPreset={() => {}}
      />,
    );
    const rateInputs = html.match(/<input\b[^>]*aria-label="نرخ اختصاصی [^"]*"[^>]*>/g) ?? [];
    assert.equal(rateInputs.length, input.tiers.length, 'every row should have an individually labeled rate input');
    // نرخ‌ها از خودِ الگو خوانده می‌شوند، نه از یک فهرست ثابت در آزمون؛ وگرنه
    // هر بازطراحی الگو این آزمون را بی‌دلیل می‌شکست.
    const rates = input.tiers.map((tier) => tier.rateOverride as number);
    assert.equal(new Set(rates).size, rates.length, 'the sample plan must give each mode its own rate');
    for (const rate of rates) {
      // فیلد نرخ با `fmtRaw(v, 2)` نوشته می‌شود؛ ممیز فارسی هم included است
      const expected = `value="${fmtRaw(rate, 2)}"`;
      const field = rateInputs.find((tag) => tag.includes(expected));
      assert.ok(field, `missing editable rate ${rate}% (looked for ${expected})`);
      assert.ok(!field.includes('disabled'), `rate ${rate}% should not be locked`);
    }
  });

  test('the optimizer result views label a feasible optimum and an infeasible fallback differently', () => {
    /* رگرسیون: پیش‌تر وقتی هیچ طرحی موجه نبود، کارت همچنان عنوان «طرح بهینهٔ
       پیشنهادی» داشت و ستون شدت نقض هم وجود نداشت، پس کاربر نمی‌توانست بفهمد
       پیشنهاد موتور چقدر از قیدها فاصله دارد. */
    const input = presetInput('sample-3');
    const applied: string[] = [];
    const onApplyLevers = (levers: Parameters<typeof designTiers>[1], label: string) => {
      const tiers = designTiers(input, levers);
      assert.ok(tiers.length === input.tiers.length, 'applying a design must not change the tier count');
      for (const t of tiers) {
        assert.ok(t.tDep >= 1 && t.tDep <= 12, `applied waiting period out of range: ${t.tDep}`);
        assert.ok(t.tLoan >= 6 && t.tLoan <= 60, `applied repayment term out of range: ${t.tLoan}`);
        assert.ok(t.alpha >= 0 && t.alpha <= 500, `applied alpha out of range: ${t.alpha}`);
        assert.ok(t.rateOverride === null || (t.rateOverride >= 0 && t.rateOverride <= 60), `applied rate out of range: ${t.rateOverride}`);
      }
      applied.push(label);
    };

    const feasible = optimizeDesign(input, { objective: 'margin', constraints: DEFAULT_CONSTRAINTS, passes: 3, topN: 6 });
    assert.ok(feasible.anyFeasible, 'the shipped defaults must admit a feasible design');
    assert.equal(resultHeadline(feasible), 'طرح بهینهٔ پیشنهادی');

    const impossible = optimizeDesign(input, {
      objective: 'margin',
      constraints: { ...DEFAULT_CONSTRAINTS, maxHolePct: 0.001 },
      passes: 2,
      topN: 6,
    });
    assert.equal(impossible.anyFeasible, false);
    assert.equal(resultHeadline(impossible), 'کم‌نقض‌ترین طرح یافت‌شده');

    for (const [label, res] of [
      ['feasible', feasible],
      ['infeasible', impossible],
    ] as const) {
      const html = render(
        <>
          <OptimizerSummary result={res} stale={false} onApplyLevers={onApplyLevers} />
          <OptimizerResultTable result={res} objective="margin" stale={false} onApplyLevers={onApplyLevers} />
        </>,
      );
      assert.ok(html.includes(resultHeadline(res)), `${label}: the headline is not rendered`);
      assert.ok(html.includes('شدت نقض'), `${label}: the severity column header is missing`);

      const rows = html.match(/<tr\b[^>]*>/g) ?? [];
      assert.equal(rows.length - 1, res.candidates.length, `${label}: one table row per candidate`);

      const badges = html.includes('موجه') ? 'feasible' : 'infeasible';
      if (label === 'feasible') {
        assert.equal(badges, 'feasible');
        // هر ردیف موجه باید ستون شدت نقض خالی (خط تیره) داشته باشد
        assert.ok(html.includes('>—<'), 'feasible rows must show an empty severity cell');
      } else {
        assert.ok(html.includes('نقض</'), 'infeasible rows must carry a violation badge');
        assert.ok(res.candidates.every((c) => !c.feasible));
        for (let i = 1; i < res.candidates.length; i++) {
          assert.ok(
            res.candidates[i - 1].severity <= res.candidates[i].severity + 1e-12,
            'the ranked list must be ordered by rising violation severity',
          );
        }
      }

      // هیچ طراحی تکراری در فهرست نامزدها
      const fps = res.candidates.map((c) => c.fingerprint);
      assert.equal(new Set(fps).size, fps.length, `${label}: duplicate design in the candidate list`);
      assertNoBrokenNumbers(html, `OptimizerPanel/${label}`);
    }
    assert.equal(applied.length, 0, 'rendering must not apply a design on its own');
  });

  test('every navigation link points at a section that actually exists', () => {
    const html = render(<App />);
    for (const item of NAV) {
      assert.ok(html.includes(`href="#${item.id}"`), `nav link #${item.id} is missing`);
      assert.ok(
        html.includes(`id="${item.id}"`),
        `nav link #${item.id} has no target element — the anchor scrolls nowhere`,
      );
    }
  });

  test('renders the analysis panels in both currencies and both themes', () => {
    for (const presetKey of ['sample-2', 'sample-3'] as const) {
      const input = presetInput(presetKey);
      const result = simulate(input, true);
      const reg = computeRegulatory(result.rows, DEFAULT_REGULATORY);
      const attr = tierAttribution(result.rows, tierColor);
      const panels: [string, ReactNode][] = [
        ['CashFlowTable', <CashFlowTable result={result} config={input.config} initialLiquidity={0} onExportCsv={() => {}} />],
        ['TierComparison', <TierComparison tiers={input.tiers} config={input.config} />],
        ['TornadoPanel', <TornadoPanel input={input} />],
        ['SensitivityPanel', <SensitivityPanel input={input} />],
        ['RegulatoryPanel', <RegulatoryPanel config={input.config} params={DEFAULT_REGULATORY} onParams={() => {}} reg={reg} />],
        ['MaturityLadder', <MaturityLadder result={result} config={input.config} reg={reg} attr={attr} />],
      ];
      for (const currency of ['toman', 'rial'] as Currency[]) {
        for (const dark of [false, true]) {
          for (const [name, node] of panels) {
            const html = render(node, currency, dark);
            assert.ok(html.length > 500, `${presetKey}/${name}/${currency}/${dark} rendered nothing`);
            assertNoBrokenNumbers(html, `${presetKey}/${name}/${currency}/${dark}`);
          }
        }
      }
    }
  });

  test('shows the empty scenario slots and then compares a saved snapshot', () => {
    const input = presetInput('sample-2');
    const result = simulate(input, true);
    const empty: ScenarioSlots = { A: null, B: null, C: null };
    const props = {
      kpis: result.kpis,
      currentRows: result.rows,
      onSnapshot: () => {},
      onLoad: () => {},
      onClear: () => {},
      onRename: () => {},
    };

    const emptyHtml = render(<ScenarioCompare {...props} slots={empty} />);
    for (const id of SLOT_IDS) assert.ok(emptyHtml.includes(`جایگاه ${id} خالی است`), `slot ${id} has no empty state`);
    assertNoBrokenNumbers(emptyHtml, 'ScenarioCompare/empty');

    const stressed = simulate({ ...input, behavior: { ...input.behavior, churnRate: 100 } }, false);
    const slots: ScenarioSlots = {
      ...empty,
      A: snapshotSlot('A', input, result.kpis, 'طرح پایه'),
      B: snapshotSlot('B', { ...input, behavior: { ...input.behavior, churnRate: 100 } }, stressed.kpis, 'خروج کامل'),
    };
    const filledHtml = render(<ScenarioCompare {...props} slots={slots} />);
    assert.ok(filledHtml.includes('طرح پایه'));
    assert.ok(filledHtml.includes('خروج کامل'));
    assert.ok(filledHtml.includes('حداکثر کسری نقدینگی'), 'the KPI comparison table is missing');
    assertNoBrokenNumbers(filledHtml, 'ScenarioCompare/filled');
  });

  test('every component module is actually mounted somewhere', () => {
    /* سه کارت کامل یک‌بار از چیدمان صفحه جدا شده بودند و ماه‌ها بدون اینکه
       هیچ آزمونی آن‌ها را صدا بزند در مخزن ماندند. این بررسی ساختاری، هر
       کامپوننتی را که هیچ فایل دیگری آن را import نکند، شکست می‌دهد. */
    const files = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.tsx'));
    const sources = new Map<string, string>();
    for (const file of files) {
      sources.set(file, readFileSync(new URL(file, import.meta.url), 'utf8'));
    }
    for (const file of files) {
      if (file.endsWith('.test.tsx')) continue;
      const name = file.replace(/\.tsx$/, '');
      const importedBy = [...sources.entries()].filter(
        ([other, code]) => other !== file && new RegExp(`from '\\./${name}'`).test(code),
      );
      const fromApp = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').includes(`./components/${name}'`);
      assert.ok(
        importedBy.length > 0 || fromApp,
        `${file} is never imported — either mount it in the layout or delete it`,
      );
    }
  });

  test('renders an empty portfolio and an out-of-horizon design without breaking', () => {
    const base = presetInput('sample-2');
    const corners: [string, ReturnType<typeof simulate>][] = [
      ['no tiers', simulate({ ...base, tiers: [] }, true)],
      ['no deposits', simulate({ ...base, behavior: { ...base.behavior, totalDeposit: 0 } }, true)],
      ['short horizon', simulate({ ...base, config: { ...base.config, horizon: 12 } }, true)],
      ['full reserve', simulate({ ...base, config: { ...base.config, reserveRatio: 100 } }, true)],
    ];
    for (const [label, result] of corners) {
      const reg = computeRegulatory(result.rows, DEFAULT_REGULATORY);
      const attr = tierAttribution(result.rows, tierColor);
      const html = render(
        <>
          <CashFlowTable result={result} config={base.config} initialLiquidity={0} onExportCsv={() => {}} />
          <TierComparison tiers={base.tiers} config={base.config} />
          <RegulatoryPanel config={base.config} params={DEFAULT_REGULATORY} onParams={() => {}} reg={reg} />
          <MaturityLadder result={result} config={base.config} reg={reg} attr={attr} />
        </>,
      );
      assert.ok(html.length > 500, `${label} rendered nothing`);
      assertNoBrokenNumbers(html, label);
    }
  });
});

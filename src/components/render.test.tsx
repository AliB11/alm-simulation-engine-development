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

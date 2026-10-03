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
import { GlobalConfigPanel } from './GlobalConfigPanel';
import { CustomerCalculator } from './CustomerCalculator';
import { ScenarioCompare } from './ScenarioCompare';
import { TornadoPanel } from './TornadoPanel';
import { TierComparison } from './TierComparison';
import { MaturityLadder } from './MaturityLadder';
import { RegulatoryPanel } from './RegulatoryPanel';
import { SensitivityPanel } from './SensitivityPanel';
import { tierAttribution } from '../lib/attribution';
import { PRESETS, tierColor } from '../lib/presets';
import { fmtRaw, toFa } from '../lib/format';
import { TIER_WAIT_MAX } from '../lib/limits';
import { TierBuilder } from './TierBuilder';
import { OptimizerResultTable, OptimizerSummary, resultHeadline } from './OptimizerPanel';
import { DEFAULT_CONSTRAINTS, designTiers, optimizeDesign } from '../lib/optimizer';
import { isNegligible, runTornado } from '../lib/tornado';

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
    assert.ok(html.includes('نمونه طرح اول'), 'the new default profile should be visible');
    assert.ok(html.includes('نمونه طرح سوم'), 'the revised third sample should remain available');
    assert.ok(!html.includes('نمونه طرح دوم'), 'the deleted second sample must not render');
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

  test('sample one exposes the selectable Bank Sepah fee choices', () => {
    const input = presetInput('sample-1');
    const configHtml = render(
      <GlobalConfigPanel
        config={input.config}
        rateOptions={[0, 2, 4]}
        programCap={PRESETS.find((preset) => preset.key === 'sample-1')?.programCap}
        onChange={() => {}}
      />,
    );
    for (const choice of ['۰٪', '۲٪', '۴٪']) {
      assert.ok(configHtml.includes(choice), `missing selectable Negin Omid Zarin fee option ${choice}`);
    }
    assert.ok(configHtml.includes('گزینه‌های کارمزد این الگو'));
    assert.ok(configHtml.includes('کارمزد انتخابی'));
    assert.ok(configHtml.includes('فرض سادهٔ سالانه'));
    assert.ok(configHtml.includes('سقف هر متقاضی اختلاف دارند'));

    const result = simulate(input, true);
    const builderHtml = render(
      <TierBuilder
        tiers={input.tiers}
        results={result.tiers}
        config={input.config}
        activePreset="sample-1"
        onChange={() => {}}
        onLoadPreset={() => {}}
      />,
    );
    assert.ok(builderHtml.includes('انتظار ۱–۱۸ ماه'));
    assert.ok(builderHtml.includes('سقف فردی'));
    assert.ok(builderHtml.includes('سقف کل طرح'));
    assert.ok(builderHtml.includes('اقساط ۱۲، ۲۴، ۳۶، ۴۸، ۶۰'));
    for (const months of [12, 24, 36, 48, 60]) {
      assert.match(
        builderHtml,
        new RegExp(`<option value="${months}"[^>]*>${fmtRaw(months)} ماه<\\/option>`),
        `missing editable ${months}-month sample-one term`,
      );
    }
  });

  test('customer calculator offers every waiting rung of the sample and the terms that rung defines', () => {
    /* طرح نمونه اول شش ردهٔ انتظار پله‌ای دارد (۱ تا ۱۸ ماه) و هر رده یک دورهٔ
       بازپرداخت مشخص؛ پس محاسبه‌گر باید همهٔ رده‌ها را پیشنهاد بدهد و برای هر
       رده دقیقاً همان اقساط تعریف‌شده را نشان دهد — نه بیشتر و نه کمتر. */
    const input = presetInput('sample-1');
    const html = render(<CustomerCalculator tiers={input.tiers} config={input.config} />);
    const waits = [...new Set(input.tiers.map((tier) => Math.round(tier.tDep)))].sort((a, b) => a - b);
    assert.deepEqual(waits, [1, 3, 6, 9, 12, 18], 'the sample must spread its waiting periods across the whole range');
    for (const wait of waits) {
      assert.match(html, new RegExp(`<option value="${wait}"[^>]*>${toFa(wait)} ماه<\\/option>`), `missing ${wait}-month waiting rung`);
    }
    for (const months of [12, 24, 36, 48, 60]) {
      assert.ok(
        input.tiers.some((tier) => tier.tLoan === months),
        `no rung offers the published ${months}-month installment`,
      );
    }
    // پیش‌فرض ۴ ماه در این رده‌ها نیست، پس نزدیک‌ترین رده (۳ ماه) انتخاب می‌شود
    assert.match(html, /<option value="3" selected="">۳ ماه<\/option>/, 'the calculator must fall back to the nearest rung');
    const top = input.tiers.filter((tier) => tier.tDep === 18);
    assert.equal(top.length, 1, 'the longest waiting rung must be unique');
    const topHtml = render(<CustomerCalculator tiers={top} config={input.config} />);
    assert.match(topHtml, /<option value="18"[^>]*>۱۸ ماه<\/option>/, 'the 18-month waiting option must be selectable');
    assert.match(
      topHtml,
      new RegExp(`<option value="${top[0].tLoan}"[^>]*>${fmtRaw(top[0].tLoan)} قسط<\\/option>`),
      'the longest waiting rung must expose its own installment term',
    );
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
    assert.ok(html.includes('انتظار ۲–۱۲ ماه'));
    assert.ok(html.includes('اقساط ۱۶، ۲۴، ۳۲، ۴۰، ۴۸، ۵۶، ۶۰'));
    assert.ok(html.includes('ضریب ۲۵٪–۲۰۰٪'));
    assert.ok(html.includes('نرخ پله ۵٪–۲۳٪'));
    for (const months of [16, 24, 32, 40, 48, 56, 60]) {
      assert.match(
        html,
        new RegExp(`<option value="${months}"[^>]*>${fmtRaw(months)} ماه<\\/option>`),
        `missing editable ${months}-month sample-three term`,
      );
    }
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
        assert.ok(t.tDep >= 1 && t.tDep <= TIER_WAIT_MAX, `applied waiting period out of range: ${t.tDep}`);
        assert.ok(t.tLoan >= 6 && t.tLoan <= 60, `applied repayment term out of range: ${t.tLoan}`);
        assert.ok(t.alpha >= 2.5 && t.alpha <= 225, `applied alpha out of range: ${t.alpha}`);
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
    for (const presetKey of ['sample-1', 'sample-3'] as const) {
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
    const input = presetInput('sample-1');
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

  test('every data table carries an accessible name', () => {
    /* یازده جدول داده‌ای در داشبورد وجود دارد؛ بدون <caption> یا aria-label
       هیچ‌کدام برای صفحه‌خوان نام مشخصی ندارند و کاربر باید حدس بزند کدام
       جدول را می‌خواند. نام‌ها بصری پنهان‌اند ولی برای فناوری کمکی خوانده
       می‌شوند. این نگهبان هم منبع را می‌پاید و هم خروجی رندرشده را. */
    const files = readdirSync(new URL('.', import.meta.url)).filter(
      (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
    );
    let tables = 0;
    for (const file of files) {
      const code = readFileSync(new URL(file, import.meta.url), 'utf8');
      const opens = code.match(/<table[\s>]/g) ?? [];
      const named = code.match(/<table[^>]*>\s*<caption/g) ?? [];
      assert.equal(
        named.length,
        opens.length,
        `${file}: ${opens.length - named.length} table(s) without an accessible name`,
      );
      tables += opens.length;
    }
    assert.ok(tables >= 10, `expected the dashboard tables to exist, found ${tables}`);
    const html = render(<App />);
    assert.ok(html.includes('<caption class="sr-only">'), 'captions must survive the render');
  });

  test('never ships a raw \\uXXXX escape or a minus-sign typo in the copy', () => {
    // رگرسیون: در مقدار رشته‌ای JSX فرار `\uXXXX` پردازش نمی‌شود؛ فرمول کارت
    // «حداکثر کسری» پیش‌تر به‌صورت متن خام «\u2212min(...)» چاپ می‌شد.
    const html = render(<App />);
    assert.ok(!html.includes('u2212'), 'a raw escape leaked into the rendered markup');
    assert.ok(html.includes('−min(0, min CumLiq_t)'), 'the hole formula must use the real minus sign');
  });

  test('the skip link precedes the header so it is the first focus target', () => {
    const html = render(<App />);
    const skip = html.indexOf('پرش به محتوای اصلی');
    const header = html.indexOf('<header');
    assert.ok(skip >= 0, 'the skip link is missing');
    assert.ok(header > skip, 'the skip link must come before the header in the tab order');
    assert.ok(html.indexOf('href="#config"') > -1 && html.indexOf('href="#config"') < header);
  });

  test('segmented controls expose their pressed state to assistive tech', () => {
    const html = render(<App />);
    assert.ok(html.includes('role="group"'), 'segmented controls need a group role');
    assert.ok(html.includes('aria-pressed="true"') && html.includes('aria-pressed="false"'));
  });

  test('info tips describe their trigger and render as a tooltip', () => {
    const input = presetInput('sample-1');
    const html = render(<GlobalConfigPanel config={input.config} onChange={() => {}} />);
    assert.ok(html.includes('aria-describedby'), 'the info triggers must be described');
    assert.ok(html.includes('role="tooltip"'));
  });

  test('the tornado table dims exactly the drivers the negligible rule flags', () => {
    /* دیم‌بودن هر ردیف باید با همان قاعدهٔ `isNegligible` بخواند؛ وگرنه رنگ
       جدول و برچسب «کم‌اثر» می‌توانند از هم جدا بیفتند. */
    const expectDimming = (input: ReturnType<typeof presetInput>, someImmaterial: boolean) => {
      const { base, bars } = runTornado(input, 'maxHole');
      const totalSwing = bars.reduce((sum, bar) => sum + bar.swing, 0);
      const html = render(<TornadoPanel input={input} />);
      const body = html.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
      const rows = body.split('<tr').slice(1);
      assert.equal(rows.length, bars.length, 'every driver must have exactly one table row');
      let dimmed = 0;
      for (const bar of bars) {
        const row = rows.find((candidate) => candidate.includes(bar.label));
        assert.ok(row, `row missing for «${bar.label}»`);
        const expected = isNegligible(bar, base, totalSwing);
        assert.equal(row!.includes('opacity-50'), expected, `«${bar.label}»: the dimming disagrees with the negligible rule`);
        if (expected) dimmed += 1;
      }
      if (someImmaterial) {
        assert.ok(dimmed > 0, 'a portfolio without product tiers must leave immaterial drivers dimmed');
        assert.ok(dimmed < bars.length, 'a driver that still moves the hole must stay legible');
      } else {
        assert.equal(dimmed, 0, 'no lever of the shipped profile is immaterial any more');
      }
    };
    expectDimming(presetInput('sample-1'), false);
    expectDimming({ ...presetInput('sample-1'), tiers: [] }, true);
  });

  test('an infinite exit leverage is shown as ∞ in the comparison table', () => {
    const input = presetInput('sample-1');
    const squeezed = { ...input, config: { ...input.config, reserveRatio: 100 } };
    const result = simulate(squeezed, true);
    assert.equal(result.kpis.leverage, Infinity);
    const html = render(
      <ScenarioCompare
        kpis={result.kpis}
        currentRows={result.rows}
        slots={{ A: snapshotSlot('A', squeezed, result.kpis, 'بافر صفر'), B: null, C: null }}
        onSnapshot={() => {}}
        onLoad={() => {}}
        onClear={() => {}}
        onRename={() => {}}
      />,
    );
    assert.ok(html.includes('∞×'), 'the table must surface the infinite leverage instead of hiding it');
  });

  test('renders an empty portfolio and an out-of-horizon design without breaking', () => {
    const base = presetInput('sample-1');
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

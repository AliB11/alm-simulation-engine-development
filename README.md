<div align="right" dir="rtl">

# 🏦 موتور شبیه‌سازی مدیریت دارایی و بدهی (ALM Simulation Engine)

### طراح سفارشی محصولات تسهیلاتی امتیازی و شبیه‌ساز ریسک نقدینگی بانکی

یک وب‌اپلیکیشن تک‌صفحه‌ای (SPA) واکنش‌گرا، راست‌چین و کاملاً فارسی برای طراحی محصولات تسهیلاتی امتیازی
(سپرده‌محور) و شبیه‌سازی بلادرنگ ریسک نقدینگی بر پایه **ماتریس جریان وجوه نقد ویژه‌محور (Cohort / Vintage Cash-Flow)**.
تمام محاسبات به‌صورت پویا در مرورگر انجام می‌شود و **هیچ ضریب یا عددی در کد هاردکد نشده است**.

</div>

---

## ✨ Features / امکانات

- **Dynamic math engine** — every rate and coefficient is user-driven; nothing is hardcoded.
- **Two Islamic contract types** — قرض‌الحسنه (Qard, fee-based) و مرابحه (Murabaha, profit-based).
- **Unlimited custom tiers** — add / edit inline / duplicate / reorder / delete product tiers.
- **3 real-market presets** — طرح مهربانی (بانک ملی)، طرح نیک‌وام (بانک ملت)، طرح نگین فراپویا (بانک سپه).
- **Cohort / Vintage cash-flow matrix** — configurable horizon (12–120 months) with lump / uniform / custom deposit scheduling.
- **Double Liquidity Drain** — simultaneous loan commitment + deposit runoff at maturity (per CBI no-blocking rule).
- **Live risk KPIs** — tipping point, maximum liquidity hole, leverage ratio, interbank funding cost, recovery month.
- **Interactive charts** (Recharts) — cumulative liquidity (green/red split at zero), inflow vs. outflow, simulated balance sheet.
- **2-D stress / sensitivity heatmap** — each cell is a full re-simulation across two risk variables.
- **Tier comparison table** — loan, installment (PMT), total fee, ROI, effective annual rate (IRR), true customer cost.
- **Monthly cash-flow table** — filters, unit scaling, per-month drill-down by tier & vintage, CSV export.
- **Methodology panel** — every formula shown with live-substituted values.
- **Toman / Rial toggle, dark / light theme, localStorage persistence, JSON scenario import/export.**

---

## 🧮 محاسبات ریاضی هسته / Core Math

<div align="right" dir="rtl">

### الف) استهلاک اقساط ماهانه (Amortization)

- قرض‌الحسنه: `PMT = (L / T_loan) × (1 + r_f × T_loan / 12)`
- مرابحه: `PMT = L × r_m(1 + r_m)^T / ((1 + r_m)^T − 1)`  که در آن `r_m = r / 12`

### ب) خروج همزمان (Double Liquidity Drain) در ماه سررسید `T_dep`

- تعهد وام: `Commitment = D × α × ρ_take × ρ_app`
- خروج سپرده: `Withdrawal = D × [ρ_take × ω_with + (1 − ρ_take) × ω_churn]`
- ضریب مؤثر با سقف فردی: `α_eff = min(α , Cap / max(میانگین سپرده، حداقل مانده))`
- پله بدون اعطا (حداقل مانده برآورده نشده یا `α_eff = 0`): چون وام‌گیرنده‌ای وجود ندارد، `Withdrawal = D × ω_churn` و `Commitment = 0`

### ج) ماتریس جریان وجوه نقد (t = ۰ … N)

- `Inflows_t  = D_new,t × (1 − RR) + Σ_k PMT_k,t`
- `Outflows_t = Σ_k Commitment_k,t + Σ_k Withdrawal_k,t`
- `NCF_t = Inflows_t − Outflows_t`
- `CumLiq_t = CumLiq_(t−1) + NCF_t`

### د) شاخص‌های ریسک نقدینگی

- نقطه واژگونی (Tipping Point): `min{ t : CumLiq_t < 0 }`
- حداکثر کسری (Max Liquidity Hole): `min_t (CumLiq_t)`
- هزینه پوشش کسری: `Σ_t max(0, −CumLiq_t) × r_ib / 12`
- اهرم خروج: `(Σ Commitment + Σ Withdrawal) / (D × (1 − RR))` — اگر مخرج صفر و صورت مثبت باشد، `∞` (نه `0×`)

</div>

---

## 🚀 Getting Started / راه‌اندازی

Requires **Node.js 20.19+ or 22.12+** (required by Vite 7).

```bash
# 1) install dependencies
npm install

# 2) run the dev server
npm run dev

# 3) production build (outputs a single self-contained dist/index.html)
npm run build

# 4) run the regression tests
npm test

# 5) preview the production build
npm run preview
```

---

## 🛠️ Tech Stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Framework  | React 19 + TypeScript                        |
| Build tool | Vite 7 (+ `vite-plugin-singlefile`)          |
| Styling    | Tailwind CSS 4 (class-based dark mode, RTL)  |
| Charts     | Recharts 3                                   |
| Icons      | lucide-react                                 |
| Font       | Vazirmatn                                    |

---

## 📁 Project Structure / ساختار پروژه

```
src/
├── App.tsx                    # Root: reactive state, persistence, layout
├── types.ts                   # Domain types (Tier, GlobalConfig, SimResult, …)
├── context/display.ts         # Currency (Toman/Rial) + theme context
├── lib/
│   ├── engine.ts              # ★ Core simulation engine (PMT, vintage matrix, KPIs, IRR, sensitivity)
│   ├── format.ts              # Persian-digit number/percent/money formatting & parsing
│   ├── presets.ts             # Default config + 3 real-market presets
│   └── io.ts                  # localStorage, CSV / JSON import-export
└── components/
    ├── ui.tsx                 # Reusable primitives (Card, NumField, Slider, Segmented, …)
    ├── Header.tsx             # Sticky nav + live risk chips + actions
    ├── GlobalConfigPanel.tsx  # §1 Global product config
    ├── TierBuilder.tsx        # §2 Dynamic tier builder + presets
    ├── CommitmentPanel.tsx    # §3 Manual resources + behavioral sliders
    ├── KpiBoard.tsx           # §3 KPI cards + risk banner + commitment table
    ├── LiquidityCharts.tsx    # §4 Liquidity risk charts
    ├── SensitivityPanel.tsx   # §4-b 2-D stress heatmap
    ├── TierComparison.tsx     # §5 Sample-deposit comparison table
    ├── CashFlowTable.tsx      # §5 Monthly cash-flow matrix (drill-down)
    └── Methodology.tsx        # Appendix: live formula trace
```

---

## 📊 Modeling Notes / نکات مدل‌سازی

<div align="right" dir="rtl">

- **سقف فردی**: چون فرمول پایه تعهد شامل سقف نیست، سقف با کاهش ضریب مؤثر `α_eff` اعمال می‌شود؛ با تنظیم سقف روی صفر،
  نتیجه دقیقاً با فرمول پایه یکسان می‌شود.
- **نرمال‌سازی تخصیص**: اگر مجموع سهم پله‌ها ۱۰۰٪ نباشد، سهم‌ها در محاسبات به‌طور خودکار نرمال می‌شوند و هشدار نمایش داده می‌شود.
- **گزینه‌های خنثی به‌صورت پیش‌فرض**: آزادسازی سپرده قانونی (خاموش)، نرخ نکول اقساط (۰)، هزینه فرصت سپرده (فقط در جدول مقایسه).
- **حداقل مانده پله**: در برآورد تجمیعی، فقط وقتی میانگین سپرده هر مشتری به حداقل مانده پله برسد، تعهد وام برای آن پله محاسبه می‌شود؛ این تقریب، توزیع مانده مشتریان را مدل نمی‌کند.
- **پله بدون اعطا**: پله‌ای که وامی اعطا نمی‌کند (حداقل مانده برآورده نشده یا `α_eff = 0`) وام‌گیرنده‌ای هم ندارد؛ بنابراین خروج سپرده‌اش فقط با `ω_churn` برآورد می‌شود و تعداد وام‌گیرندهٔ آن صفر گزارش می‌گردد (در جدول تعهدات با نشان «بدون اعطا» مشخص است).
- **بهداشت ورودی موتور**: همهٔ ورودی‌های عددی (پله، پیکربندی، رفتار، زمان‌بندی) پیش از محاسبه با `finite`/`bounded` پالایش می‌شوند؛ یک مقدار `NaN`/خالی نمی‌تواند کل ماتریس و شاخص‌ها را `NaN` کند و داشبورد به‌اشتباه «پایدار» نشان دهد.
- **اهرم ∞**: اگر منابع ورودی خالص صفر باشد (مثلاً `RR = 100%`) و همچنان خروجی وجود داشته باشد، اهرم خروج `∞` نمایش داده می‌شود؛ عدد `0×` در این حالت به‌اشتباه ایمن به نظر می‌رسید.
- **نکول**: بخش وصول‌نشده اقساط از جریان نقد حذف می‌شود و اصل وصول‌نشده تا زمان تعریف فرض بازیافت/سوخت‌شدن، در مانده تسهیلات باقی می‌ماند. ارقام «کل بازپرداخت/کارمزد» در روش‌شناسی **قراردادی**‌اند و وصولی واقعی در افق، جداگانه گزارش می‌شود.
- **زمان‌بندی سفارشی**: ویژه‌های خارج از افق حذف و سهم باقی‌مانده بازمقیاس می‌شود؛ پیش‌نمایش ریالی جدول زمان‌بندی نیز از همان مخرج استفاده می‌کند تا با ماتریس واگرا نشود.
- **افق کوتاه**: اگر بخشی از تعهدات/اقساط خارج از افق قرار گیرد، هشدار شفاف نمایش داده می‌شود.
- **منبع پیش‌تنظیم‌ها**: ارقام از اطلاعات عمومی منتشرشده گرفته شده و برخی ضرایب تقریبی‌اند؛ نتایج صرفاً جنبه تحلیلی/آموزشی دارد.

</div>

> **Disclaimer:** This tool is for analytical and educational simulation only. Preset figures are drawn from
> publicly available information and some coefficients are approximate. It is **not** financial advice.

---

## 📄 License

Released under the [MIT License](./LICENSE).

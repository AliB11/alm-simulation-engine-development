<div align="right" dir="rtl">

# 🏦 موتور شبیه‌سازی مدیریت دارایی و بدهی (ALM Simulation Engine)

### طراح سفارشی محصولات تسهیلاتی امتیازی و شبیه‌ساز ریسک نقدینگی بانکی

یک وب‌اپلیکیشن تک‌صفحه‌ای (SPA) واکنش‌گرا، راست‌چین و کاملاً فارسی برای طراحی محصولات تسهیلاتی امتیازی
(سپرده‌محور) و شبیه‌سازی بلادرنگ ریسک نقدینگی بر پایه **ماتریس جریان وجوه نقد ویژه‌محور (Cohort / Vintage Cash-Flow)**.
تمام محاسبات به‌صورت پویا در مرورگر انجام می‌شود؛ سه الگوی عمومی صرفاً برای شروع طراحی ارائه شده‌اند و ضرایب و حدودشان قابل ویرایش است.

</div>

---

## ✨ Features / امکانات

- **Dynamic math engine** — rates and coefficients update live from the active configuration; sample profiles are editable starting points.
- **Two Islamic contract types** — قرض‌الحسنه (Qard, fee-based) و مرابحه (Murabaha, profit-based).
- **Unlimited custom tiers** — add / edit inline / duplicate / reorder / delete product tiers.
- **3 editable sample profiles** — الگوهای عمومی، بدون نام یا وابستگی به محصول بانکی مشخص.
- **Cohort / Vintage cash-flow matrix** — configurable horizon (12–120 months) with lump / uniform / custom deposit scheduling.
- **Double Liquidity Drain** — simultaneous loan commitment + deposit runoff at maturity (per CBI no-blocking rule).
- **Live risk KPIs** — tipping point, maximum liquidity hole, leverage ratio, interbank funding cost, recovery month.
- **Simulated P&L** — fee/profit income collected, deposit profit paid on closing balances, interbank funding cost and the
  resulting **net margin** (with a monthly income/expense/cumulative-margin chart). Neutral at `r_dep = 0`.
- **Interactive charts** (Recharts) — cumulative liquidity (green/red split at zero), inflow vs. outflow, simulated balance sheet.
- **2-D stress / sensitivity heatmap** — each cell is a full re-simulation across two of 8 risk variables
  (take-up, approval, runoff, churn, reserve ratio, α scale, price, deposit profit) × 5 metrics
  (max hole, tipping point, end balance, leverage, net margin).
- **Customer loan calculator** — enter an average deposit balance, waiting period and repayment term to estimate eligibility, loan amount, monthly payment and total repayment using the active product rules.
- **Cash-flow CSV export** — download the modeled monthly matrix from the toolbar when a detailed review is needed.
- **Inverse tier designer** — coordinate search over α scale, waiting period, repayment and allocation tilt, subject to
  liquidity, leverage and margin constraints, with one-click apply.
- **Monte Carlo / VaR** — seeded, reproducible draws of behavioral inputs; P(tipping), P(loss), P5–P99 and load-worst-run.
- **Regulatory-style proxies** — monthly LCR, NSFR at month 12 and the asset/liability maturity gap, with user-set weights.
  These are educational stand-ins, not official supervisor calculations.
- **Maturity ladder + tier attribution** — when principal returns versus when deposits leave, and which tier builds the hole
  (analytic removal, no extra simulation).
- **Methodology panel** — every formula shown with live-substituted values.
- **Toman / Rial toggle, dark / light theme, localStorage persistence, JSON scenario import/export.**
- **Offline Persian font** — Vazirmatn is bundled (OFL-1.1); the single-file build does not call Google Fonts.
- **Golden-number tests + CI** — the three sample profiles are frozen to the rial, and GitHub Actions runs typecheck, tests and build.

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
- `Outflows_t = Σ_k Commitment_k,t + Σ_k Withdrawal_k,t + Profit_t`
- `NCF_t = Inflows_t − Outflows_t`
- `CumLiq_t = CumLiq_(t−1) + NCF_t`

### د) شاخص‌های ریسک نقدینگی

- نقطه واژگونی (Tipping Point): `min{ t : CumLiq_t < 0 }`
- حداکثر کسری (Max Liquidity Hole): `min_t (CumLiq_t)`
- هزینه پوشش کسری: `Σ_t max(0, −CumLiq_t) × r_ib / 12`
- اهرم خروج: `(Σ Commitment + Σ Withdrawal) / (D × (1 − RR))` — اگر مخرج صفر و صورت مثبت باشد، `∞` (نه `0×`)

### هـ) صورت سود و زیان شبیه‌سازی‌شده

- سود پرداختی سپرده: `Profit_t = DepositBalance_t × r_dep / 12` (پایان هر ماه، روی ماندهٔ پایان دوره)
- `Outflows_t = Σ Commitment + Σ Withdrawal + Profit_t` — یعنی سود سپرده یک خروجی نقد واقعی است و بر نقطهٔ واژگونی هم اثر می‌گذارد
- درآمد خالص: `NII = Σ_t Income_t − Σ_t Profit_t`
- حاشیهٔ خالص: `Margin = NII − Σ_t max(0, −CumLiq_t) × r_ib / 12`
- حاشیهٔ تجمعی ماهانه: `Margin_t = Margin_(t−1) + Income_t − Profit_t − FundingCost_t`

### و) سنجه‌های مقرراتی‌مانند (آموزشی، نه رسمی)

ضرایب `ω` (خروج استرس)، `w` (پایداری منابع) و `r` (نیاز به تأمین دارایی) ورودی کاربرند و پیش‌فرض‌شان به‌ترتیب ۵٪، ۹۰٪ و ۸۵٪ است.

- `LCR_t = max(0, CumLiq_t) / (Outflow_t + ω × DepositBalance_t) × 100` — ماه بدون خروج، پوشش نامحدود (`∞`) است و از کمینه کنار گذاشته می‌شود
- `NSFR_m = (DepositBalance_m × w) / (LoanBook_m × r) × 100` با `m = 12` (یا آخرین ماه، اگر افق کوتاه‌تر باشد)
- `WAL = Σ t × Flow_t / Σ Flow_t` و `Gap = WAL(دارایی) − WAL(تعهدات)`
- ماندهٔ سپرده‌ای که تا پایان افق زنده می‌ماند، در WAL تعهدات با سررسید بازِ آخرین ماه لحاظ می‌شود

### ز) انتساب حفره به پله‌ها

- `cum′_k(t) = cum(t) − Σ_{j≤t} ncf_k(j)` — حذف کامل پلهٔ k بدون شبیه‌سازی مجدد
- `Δحفره_k = maxHole(بدون k) − maxHole(پایه)` — منفی یعنی آن پله منبع فشار نقدینگی است
- سود سپرده یک جریان سطح‌پرتفوی است و به نسبت ماندهٔ رویدادمحور هر پله توزیع می‌شود

### ح) مونت‌کارلو

شدت عدم قطعیت (`intensity`، ۰ تا ۱۰۰) تنها اهرم مقیاس است و صفر یعنی اجرای کاملاً قطعی:

- نرخ‌ها: `ρ′ = clamp(ρ + ε × intensity/100 × 20, 0, 100)` با `ε ~ N(0,1)` (در شدت ۱۰۰٪، انحراف معیار ۲۰ واحد درصد)
- حجم منابع: `D′ = D × exp(ε × intensity/100 × 0.25)`
- شوک زمان‌بندی: `round(ε × intensity/100 × 1.5)` ماه، بدون از دست رفتن حجم سپرده
- `P(واژگونی)`، `P(زیان)` و صدک‌های P5…P99 از همان موتور قطعی، روی ورودی‌های نمونه‌گیری‌شده
- مولد `mulberry32` با دانهٔ قابل تنظیم؛ نتیجه با دانهٔ یکسان دقیقاً بازتولید می‌شود

### ط) بهینه‌یاب طراحی

جست‌وجوی نزولی مختصاتی روی شبکهٔ گسستهٔ چهار اهرم، حداکثر سه گذر. موجه بودن (رعایت همهٔ قیدها) بر مقدار هدف اولویت دارد و در تساوی، طرح نزدیک‌تر به طراحی جاری انتخاب می‌شود. ضریب برابری حاصل از سقف سازندهٔ پله (۵۰۰٪) فراتر نمی‌رود تا طرحِ اعمال‌شده قابل ویرایش و قابل ورود مجدد باشد.

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

# 4) typecheck and regression tests (same commands CI runs)
npm run typecheck
npm test

# 5) preview the production build
npm run preview
```

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, the test suite and the production build on every push and pull request, and fails if the single-file build still references Google Fonts or failed to inline Vazirmatn.

---

## 🛠️ Tech Stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Framework  | React 19 + TypeScript                        |
| Build tool | Vite 7 (+ `vite-plugin-singlefile`)          |
| Styling    | Tailwind CSS 4 (class-based dark mode, RTL)  |
| Charts     | Recharts 3                                   |
| Icons      | lucide-react                                 |
| Font       | Vazirmatn variable, self-hosted (OFL-1.1)    |

---

## 📁 Project Structure / ساختار پروژه

```
src/
├── App.tsx                    # Root: reactive state, persistence, layout
├── types.ts                   # Domain types (Tier, GlobalConfig, SimResult, …)
├── context/display.ts         # Currency (Toman/Rial) + theme context
├── lib/
│   ├── engine.ts              # ★ Core simulation engine (PMT, vintage matrix, KPIs, IRR, sensitivity)
│   ├── optimizer.ts           # Inverse tier designer (coordinate descent)
│   ├── monteCarlo.ts          # Seeded Monte Carlo / VaR
│   ├── regulatory.ts          # LCR / NSFR / WAL proxies + maturity buckets
│   ├── attribution.ts         # Analytic tier attribution of the liquidity hole
│   ├── scenarios.ts           # Scenario slot model + KPI comparison rows
│   ├── format.ts              # Persian-digit number/percent/money formatting & parsing
│   ├── presets.ts             # Default config + 3 editable sample profiles
│   ├── limits.ts              # Shared input bounds (not model coefficients)
│   ├── eventMeta.ts           # Single source of truth for cash-flow event signs
│   ├── io.ts                  # localStorage, matrix/ledger CSV, JSON, scenario slots
│   ├── golden.test.ts         # Frozen KPI numbers for the three sample profiles
│   └── *.test.ts              # Engine, optimizer, Monte Carlo, regulatory, import regressions
└── components/
    ├── ui.tsx                 # Reusable primitives (Card, NumField, Slider, Segmented, …)
    ├── Header.tsx             # Sticky nav + live risk chips + actions
    ├── GlobalConfigPanel.tsx  # §1 Global product config
    ├── TierBuilder.tsx        # §2 Dynamic tier builder + presets
    ├── CommitmentPanel.tsx    # §3 Manual resources + behavioral sliders
    ├── KpiBoard.tsx           # §3 KPI cards + risk banner + commitment table
    ├── ProfitLossPanel.tsx    # §3 Simulated P&L (income / deposit profit / funding cost / net margin)
    ├── LiquidityCharts.tsx    # §4 Liquidity risk charts
    ├── SensitivityPanel.tsx   # §4-b 2-D stress heatmap
    ├── MonteCarloPanel.tsx    # §4-c Monte Carlo / VaR
    ├── OptimizerPanel.tsx     # §4-c Inverse tier designer
    ├── RegulatoryPanel.tsx    # §4-d LCR / NSFR / maturity-gap proxies
    ├── MaturityLadder.tsx     # §4-d Maturity ladder + tier attribution
    ├── CustomerCalculator.tsx # §5 Customer loan and installment estimate
    └── Methodology.tsx        # Appendix: live formula trace
```

---

## 📊 Modeling Notes / نکات مدل‌سازی

<div align="right" dir="rtl">

- **سقف فردی**: چون فرمول پایه تعهد شامل سقف نیست، سقف با کاهش ضریب مؤثر `α_eff` اعمال می‌شود؛ با تنظیم سقف روی صفر،
  نتیجه دقیقاً با فرمول پایه یکسان می‌شود.
- **نرمال‌سازی تخصیص**: اگر مجموع سهم پله‌ها ۱۰۰٪ نباشد، سهم‌ها در محاسبات به‌طور خودکار نرمال می‌شوند و هشدار نمایش داده می‌شود.
- **گزینه‌های خنثی به‌صورت پیش‌فرض**: آزادسازی سپرده قانونی (خاموش)، نرخ نکول اقساط (۰) و نرخ سود پرداختی سپرده (۰).
- **سود پرداختی سپرده**: روی ماندهٔ پایان دورهٔ هر ماه محاسبه می‌شود (نه معدل ماهانه) تا برای ورود یکجا در ماه صفر، دقیقاً
  به تعداد ماه‌های ماندگاری سود شناسایی شود. نمونهٔ سوم برای نمایش این اثر، نرخ ۲۰٫۵٪ را به‌صورت پیش‌فرض فعال می‌کند؛
  دو نمونهٔ قرض‌الحسنه بدون سود (۰٪) هستند.
- **حداقل مانده پله**: موتور تجمیعی فقط در صورت رسیدن میانگین سپردهٔ مشتری نمونه به حداقل مانده، تعهد وام را برای آن حالت لحاظ می‌کند. محاسبه‌گر مشتری نیز همان شرط را برای ماندهٔ واردشده اعمال می‌کند.
- **پله بدون اعطا**: پله‌ای که وامی اعطا نمی‌کند (حداقل مانده برآورده نشده یا `α_eff = 0`) وام‌گیرنده‌ای هم ندارد؛ بنابراین خروج سپرده‌اش فقط با `ω_churn` برآورد می‌شود و تعداد وام‌گیرندهٔ آن صفر گزارش می‌گردد (در جدول تعهدات با نشان «بدون اعطا» مشخص است).
- **بهداشت ورودی موتور**: همهٔ ورودی‌های عددی (پله، پیکربندی، رفتار، زمان‌بندی) پیش از محاسبه با `finite`/`bounded` پالایش می‌شوند؛ یک مقدار `NaN`/خالی نمی‌تواند کل ماتریس و شاخص‌ها را `NaN` کند و داشبورد به‌اشتباه «پایدار» نشان دهد.
- **اهرم ∞**: اگر منابع ورودی خالص صفر باشد (مثلاً `RR = 100%`) و همچنان خروجی وجود داشته باشد، اهرم خروج `∞` نمایش داده می‌شود؛ عدد `0×` در این حالت به‌اشتباه ایمن به نظر می‌رسید.
- **نکول**: بخش وصول‌نشده اقساط از جریان نقد حذف می‌شود و اصل وصول‌نشده تا زمان تعریف فرض بازیافت/سوخت‌شدن، در مانده تسهیلات باقی می‌ماند. ارقام «کل بازپرداخت/کارمزد» در روش‌شناسی **قراردادی**‌اند و وصولی واقعی در افق، جداگانه گزارش می‌شود.
- **زمان‌بندی سفارشی**: ویژه‌های خارج از افق حذف و سهم باقی‌مانده بازمقیاس می‌شود؛ پیش‌نمایش ریالی جدول زمان‌بندی نیز از همان مخرج استفاده می‌کند تا با ماتریس واگرا نشود.
- **افق کوتاه**: اگر بخشی از تعهدات/اقساط خارج از افق قرار گیرد، هشدار شفاف نمایش داده می‌شود.
- **الگوهای نمونه**: اعداد صرفاً برای نمایش رفتار مدل انتخاب شده‌اند، به مؤسسهٔ مشخصی وابستگی ندارند و پیشنهاد تسهیلات محسوب نمی‌شوند.
- **اعداد طلایی**: `src/lib/golden.test.ts` سنجه‌های سه الگوی نمونه را با ورودی‌های پیش‌فرض، در سطح ریال گرد‌شده، فریز کرده است. هر تغییری که این اعداد را جابه‌جا کند باید آگاهانه و همراه با به‌روزرسانی همان فایل باشد.
- **سنجه‌های LCR/NSFR**: تقریب آموزشی برای مقایسهٔ طرح‌ها هستند و تعریف کمیتهٔ بال یا الزام ناظر داخلی را پیاده نمی‌کنند. همهٔ ضرایب‌شان از رابط کاربری می‌آید و با سناریو ذخیره می‌شود.
- **بهینه‌یاب**: جست‌وجوی مختصاتی است، نه تضمین بهینهٔ سراسری. اگر هیچ طرحی همهٔ قیدها را برآورده نکند، کم‌نقض‌ترین طرح نشان داده می‌شود و دکمهٔ اعمال تا اجرای مجدد (پس از تغییر ورودی) غیرفعال می‌ماند.
- **مونت‌کارلو**: مقیاس توزیع‌ها تعریف خود لغزندهٔ «شدت» است (در شدت ۱۰۰٪، σ نرخ‌ها ۲۰ واحد درصد و σ لگاریتمی حجم منابع ۲۵٪). شدت صفر اجرا را دقیقاً به شبیه‌سازی قطعی برمی‌گرداند.
- **فونت**: وزیرمتن متغیر به‌صورت محلی بسته‌بندی شده (مجوز OFL-1.1 در `src/assets/fonts/OFL.txt`) و در خروجی تک‌فایل درون‌خط می‌شود؛ برنامه برای نمایش فارسی به اینترنت نیاز ندارد.

</div>

> **Disclaimer:** This tool is for analytical and educational simulation only. Sample profiles are illustrative and
> do not describe a specific institution or guarantee eligibility, approval, or disbursement. It is **not** financial advice.

---

## 📄 License

Released under the [MIT License](./LICENSE).

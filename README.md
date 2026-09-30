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
- **Simulated P&L** — fee/profit income collected, deposit profit paid on average monthly balances, interbank funding cost,
  non-cash loan-loss provisions and the resulting **net margin** (with a monthly income/expense/cumulative-margin chart).
  Neutral at `r_dep = 0` and `δ = 0`.
- **Interactive charts** (Recharts) — cumulative liquidity (green/red split at zero), inflow vs. outflow, simulated balance sheet.
- **2-D stress / sensitivity heatmap** — each cell is a full re-simulation across two of 9 risk variables
  (take-up, approval, runoff, churn, reserve ratio, α scale, price, deposit profit) × 5 metrics
  (max hole, tipping point, end balance, leverage, net margin).
- **Tornado risk-driver ranking** — one-at-a-time shocks over the same stress grid, sorted by swing, so the heatmap's
  "which two interact" question is complemented by "which lever matters most".
- **Monthly cash-flow matrix with event drill-down** — every month expands into its per-tier / per-vintage transactions
  (deposit, legal reserve, installments, disbursement, withdrawal, deposit profit) with a live `NCF → CumLiq` trace.
- **Scenario slots A / B / C** — snapshot the whole design, keep editing, and compare KPIs, config diffs and overlapping
  liquidity paths side by side; slots survive a page reload.
- **Customer loan calculator** — enter an average deposit balance, waiting period and repayment term to estimate eligibility, loan amount, monthly payment and total repayment using the active product rules.
- **Per-tier customer comparison** — the same deposit priced against every tier: loan, installment, ROI, effective annual
  rate (IRR) and the customer's real cost after the opportunity cost of waiting.
- **Cash-flow CSV + general-ledger CSV export** — the monthly matrix, or one signed row per tier/vintage event that
  reconciles exactly to `CumLiq(H)` for Excel / BI review.
- **Inverse tier designer** — multi-start coordinate search over α scale, waiting period, repayment term, contract rate and
  allocation tilt, subject to liquidity, leverage and margin constraints, with one-click apply. Feasibility outranks the
  objective: when nothing satisfies every constraint the panel ranks designs by *violation severity* instead of quietly
  recommending the one with the biggest objective and the worst liquidity hole, and lever combinations that clamp to the
  same tiers collapse into a single candidate.
- **Monte Carlo / VaR** — seeded, reproducible draws of behavioral inputs; P(tipping), P(loss), P5–P99 and load-worst-run.
- **Regulatory-style proxies** — monthly LCR (with retail/wholesale runoff split and HQLA haircut), NSFR at month 12 and
  the asset/liability maturity gap, with user-set weights. These are educational stand-ins, not official supervisor calculations.
- **Maturity ladder + tier attribution** — when principal returns versus when deposits leave, and which tier builds the hole
  (analytic removal, no extra simulation).
- **Methodology panel** — every formula shown with live-substituted values.
- **Toman / Rial toggle, dark / light theme, localStorage persistence, JSON scenario import/export.**
- **Offline Persian font** — Vazirmatn is bundled (OFL-1.1); the single-file build does not call Google Fonts.
- **Golden-number tests + CI** — the three sample profiles are frozen to the rial, and GitHub Actions runs lint,
  typecheck, tests and build, plus a server-render smoke test of every section and an orphan-component guard.

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
- حاشیه به درصد منابع خالص: `Margin / (D × (1 − RR))` — با همان قاعدهٔ علامت: اگر مخرج صفر باشد `±∞` برمی‌گردد،
  چون عدد صفر در این حالت به‌اشتباه «سر‌به‌سر» خوانده می‌شود در حالی که طرح می‌تواند زیان‌ده باشد

### هـ) صورت سود و زیان شبیه‌سازی‌شده

- سود پرداختی سپرده: `Profit_t = AvgBalance_t × r_dep / 12` که `AvgBalance_t = (ماندهٔ ابتدای ماه + ماندهٔ پایان ماه) / ۲` (ماه‌شمار)
- `Outflows_t = Σ Commitment + Σ Withdrawal + Profit_t` — یعنی سود سپرده یک خروجی نقد واقعی است و بر نقطهٔ واژگونی هم اثر می‌گذارد
- درآمد خالص: `NII = Σ_t Income_t − Σ_t Profit_t`
- ذخیرهٔ زیان موردانتظار: `Provision = Σ L × δ × LGD` در ماه اعطا شناسایی می‌شود (غیرنقدی — فقط حاشیه) و اصل وصول‌نشده در ماه `T_dep + T_loan + مهلت‌سوخت` از مانده تسهیلات خارج می‌گردد
- حاشیهٔ خالص: `Margin = NII − Σ_t max(0, −CumLiq_t) × r_ib / 12 − Σ_t Provision_t`
- حاشیهٔ تجمعی ماهانه: `Margin_t = Margin_(t−1) + Income_t − Profit_t − FundingCost_t − Provision_t`

### و) سنجه‌های مقرراتی‌مانند (آموزشی، نه رسمی)

ضرایب `ω` (خروج استرس خرد)، `w` (پایداری منابع) و `r` (نیاز به تأمین دارایی) ورودی کاربرند و پیش‌فرض‌شان به‌ترتیب ۵٪، ۹۰٪ و ۸۵٪ است؛
سهم سپردهٔ کلان `s` (پیش‌فرض ۰٪) با نرخ خروج استرس جداگانهٔ `ω_w` (پیش‌فرض ۲۵٪) و تنزیل دارایی نقد `h` (پیش‌فرض ۰٪) نیز ورودی کاربرند.

- `ω_eff = (1 − s) × ω + s × ω_w` و `LCR_t = max(0, CumLiq_t) × (1 − h) / (Outflow_t + ω_eff × DepositBalance_t) × 100` — ماه بدون خروج، پوشش نامحدود (`∞`) است و از کمینه کنار گذاشته می‌شود
- `NSFR_m = (DepositBalance_m × w) / (LoanBook_m × r) × 100` با `m = 12` (یا آخرین ماه، اگر افق کوتاه‌تر باشد)
- `WAL = Σ t × Flow_t / Σ Flow_t` و `Gap = WAL(دارایی) − WAL(تعهدات)`
- سمت دارایی روی بازگشت اصل سرمایه و سمت تعهد روی **همان خروجی نردبان** (`برداشت + سود پرداختی سپرده`) وزن می‌شود؛
  کنار گذاشتن سود سپرده، عمر تعهدات را کوتاه‌تر و شکاف سررسید را بزرگ‌تر از واقع نشان می‌داد
- ماندهٔ سپرده‌ای که تا پایان افق زنده می‌ماند، در WAL تعهدات با سررسید بازِ آخرین ماه لحاظ می‌شود
- سطل‌بندی زمانی نردبان و نقشهٔ حرارتی از یک قاعدهٔ مشترک پیروی می‌کند و اندازه‌اش از **افق** (شمارهٔ آخرین ماه)
  گرفته می‌شود نه از تعداد ردیف‌ها: `≤ ۲۴ → ۱ ماهه`، `≤ ۶۰ → ۳ ماهه`، `≤ ۱۸۰ → ۶ ماهه`، بیشتر → `۱۲ ماهه`

### و-۲) نمودار گردبادی (حساسیت تک‌متغیره)

- هر متغیر ریسک به‌تنهایی بین دو کران **همان شبکهٔ آزمون بحران** تکان داده می‌شود و بقیه ثابت می‌ماند
- `swing_k = max(metric_low , metric_high , metric_base) − min(...)` و میله‌ها نزولی بر پایهٔ `swing` مرتب می‌شوند
- «واژگونی ندارد» به‌جای `null` با `H + 1` جایگزین می‌شود تا امن‌ترین حالت بزرگ‌ترین عدد باشد
- اهرم خروج برای نمایش در `۱۰۰×` سقف می‌گیرد تا یک خانهٔ `∞` مقیاس کل نمودار را نخورد

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
- هزینهٔ ذخیره مطالبات هم صدک‌بندی می‌شود؛ اجراهای با اهرم نامتناهی (منابع خالص صفر) از صدک‌های اهرم کنار گذاشته و شمرده می‌شوند
- مولد `mulberry32` با دانهٔ قابل تنظیم؛ نتیجه با دانهٔ یکسان دقیقاً بازتولید می‌شود

### ط) بهینه‌یاب طراحی

جست‌وجوی نزولی مختصاتی چندشروعی روی شبکهٔ گسستهٔ **پنج اهرم** (مقیاس α، جابه‌جایی دورهٔ انتظار، جابه‌جایی دورهٔ بازپرداخت، جابه‌جایی نرخ عقد و کج‌کردن سهم تخصیص) از طرح جاری و کران‌های هر اهرم، حداکثر سه گذر از هر نقطهٔ شروع.

- **اهرم نرخ عقد** از نسخهٔ جاری اضافه شده است؛ بدون آن، روی الگویی که نرخ پله‌هایش زیر نرخ سود سپرده است هیچ ترکیبی از α و دوره‌ها نمی‌توانست طرح را سودآور کند. نرخ حاصل در همان سقف سازندهٔ پله و ورود فایل (۶۰٪) مهار می‌شود و اگر پله‌ای نرخ اختصاصی نداشته باشد، نرخ سراسری + جابه‌جایی به‌صورت نرخ اختصاصی ثبت می‌شود.
- **ترتیب اولویت**: ۱) موجه بودن اولویت مطلق دارد؛ ۲) اگر هیچ طرحی موجه نبود، کمترین «شدت نقض» ملاک است نه بزرگ‌ترین عدد هدف (هر نقض نسبت به سقف خودش نرمال می‌شود تا درصد، نسبت و تومان قابل جمع باشند)؛ ۳) سپس مقدار هدف بیشینه می‌شود؛ ۴) تساوی به سمت حفرهٔ نقدینگی کمتر و حاشیهٔ خالص بیشتر شکسته می‌شود؛ ۵) و در نهایت طرح نزدیک‌تر به طراحی جاری.
- **حذف طراحی‌های همسان**: رتبه‌بندی بر پایهٔ «اثر انگشت پله‌ها» است نه ترکیب اهرم‌ها. چون `T_dep` در ۱۲ و `T_loan` در ۶۰ مهار می‌شود، چندین جابه‌جایی مثبت به پله‌های یکسان می‌رسید و فهرست نامزدها را با ردیف‌های تکراری پر می‌کرد.
- ضریب برابری حاصل از سقف سازندهٔ پله (۵۰۰٪) فراتر نمی‌رود تا طرحِ اعمال‌شده قابل ویرایش و قابل ورود مجدد باشد.
- سقف پیش‌فرض حفرهٔ نقدینگی ۴۵٪ است. مقدار پیشین (۱۰٪) با فرض‌های رفتاری پیش‌فرض دست‌یافتنی نبود و در نتیجه «هیچ طرح موجهی» پیدا نمی‌شد و کل منطق قیدها عملاً از کار می‌افتاد.

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

# 4) the same checks CI runs
npm run lint        # ESLint (typescript-eslint + react-hooks)
npm run typecheck   # tsc --noEmit
npm test            # node --test through tsx: engine, golden numbers, UI smoke
npm run verify      # lint + typecheck + test + build in one go

# 5) preview the production build
npm run preview
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, the test suite and the production build on every push
and pull request. It then fails if the single-file build references any external resource (font, script, stylesheet or
`@import`), or if a navigation anchor in the header points at a section that does not exist.

### Test layout / چیدمان آزمون‌ها

| File | What it freezes |
| ---- | --------------- |
| `src/lib/golden.test.ts` | The KPI set of the three sample profiles, rounded to the rial |
| `src/lib/engine.test.ts` | Amortization, drain rules, NaN hygiene, `∞` conventions, simulated P&L |
| `src/lib/buckets.test.ts` | The shared time-bucket rule used by the ladder **and** the heat map |
| `src/lib/tornado.test.ts` | One-at-a-time shocks stay consistent with the 2-D stress grid |
| `src/lib/regulatory.test.ts` | LCR / NSFR / WAL proxies and analytic tier attribution |
| `src/lib/monteCarlo.test.ts` | Seeded reproducibility, intensity 0 ⇒ the deterministic engine |
| `src/lib/optimizer.test.ts` | Feasibility outranks the objective; ties prefer the current design |
| `src/lib/io.test.ts` | Sanitizing hostile imports and the CSV / JSON writers |
| `src/components/render.test.tsx` | Server-renders every section (both currencies, both themes), asserts no `NaN` leaks, and fails if a component is never mounted |

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
| Quality    | ESLint 10 + typescript-eslint + react-hooks  |
| Tests      | `node --test` via tsx (no test framework)    |

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
│   ├── regulatory.ts          # LCR / NSFR / WAL proxies + maturity ladder
│   ├── attribution.ts         # Analytic tier attribution of the liquidity hole
│   ├── tornado.ts             # One-at-a-time sensitivity / risk-driver ranking
│   ├── buckets.ts             # ★ Single source of truth for time-bucket sizing
│   ├── scenarios.ts           # Scenario slot model + KPI comparison rows
│   ├── format.ts              # Persian-digit number/percent/money formatting & parsing
│   ├── presets.ts             # Default config + 3 editable sample profiles
│   ├── limits.ts              # Shared input bounds (not model coefficients)
│   ├── eventMeta.ts           # Single source of truth for cash-flow event signs
│   ├── io.ts                  # localStorage, matrix/ledger CSV, JSON, scenario slots
│   ├── golden.test.ts         # Frozen KPI numbers for the three sample profiles
│   └── *.test.ts              # Engine, buckets, tornado, optimizer, Monte Carlo, regulatory, imports
└── components/
    ├── ui.tsx                 # Reusable primitives (Card, NumField, Slider, Segmented, …)
    ├── Header.tsx             # Sticky nav + live risk chips + actions
    ├── GlobalConfigPanel.tsx  # §1 Global product config
    ├── TierBuilder.tsx        # §2 Dynamic tier builder + presets
    ├── CommitmentPanel.tsx    # §3 Manual resources + behavioral sliders
    ├── KpiBoard.tsx           # §3 KPI cards + risk banner + commitment table
    ├── ProfitLossPanel.tsx    # §3 Simulated P&L (income / deposit profit / funding cost / net margin)
    ├── CashFlowTable.tsx      # §3 Monthly matrix with per-tier/per-vintage event drill-down
    ├── LiquidityCharts.tsx    # §4 Liquidity risk charts
    ├── SensitivityPanel.tsx   # §4-b 2-D stress heatmap
    ├── TornadoPanel.tsx       # §4-b Tornado ranking of risk drivers
    ├── MonteCarloPanel.tsx    # §4-c Monte Carlo / VaR
    ├── OptimizerPanel.tsx     # §4-c Inverse tier designer
    ├── RegulatoryPanel.tsx    # §4-d LCR / NSFR / maturity-gap proxies
    ├── MaturityLadder.tsx     # §4-d Maturity ladder + tier attribution
    ├── ScenarioCompare.tsx    # §4-e Scenario slots A/B/C, KPI diff and overlapping paths
    ├── CustomerCalculator.tsx # §5 Customer loan and installment estimate
    ├── TierComparison.tsx     # §5 Same deposit priced against every tier (ROI / IRR)
    ├── Methodology.tsx        # Appendix: live formula trace
    └── render.test.tsx        # Server-render smoke test + orphan-component guard
```

---

## 📊 Modeling Notes / نکات مدل‌سازی

<div align="right" dir="rtl">

- **سقف فردی**: چون فرمول پایه تعهد شامل سقف نیست، سقف با کاهش ضریب مؤثر `α_eff` اعمال می‌شود؛ با تنظیم سقف روی صفر،
  نتیجه دقیقاً با فرمول پایه یکسان می‌شود.
- **نرمال‌سازی تخصیص**: اگر مجموع سهم پله‌ها ۱۰۰٪ نباشد، سهم‌ها در محاسبات به‌طور خودکار نرمال می‌شوند و هشدار نمایش داده می‌شود.
- **گزینه‌های خنثی به‌صورت پیش‌فرض**: آزادسازی سپرده قانونی (خاموش)، نرخ نکول اقساط (۰) و نرخ سود پرداختی سپرده (۰).
- **سود پرداختی سپرده**: ماه‌شمار روی میانگین ماندهٔ ماهانه ((ابتدا + انتهای ماه) ÷ ۲) محاسبه می‌شود تا واریز و برداشت‌های
  میانی ماه نیز به‌طور منصفانه سود بگیرند. نمونهٔ سوم نرخ ۰٫۱٪ را فعال می‌کند — عملاً صفر، ولی غیرصفر تا همین
  ماه‌شمار میانگین مانده در هر سه نمونه تمرین شود؛ دو نمونهٔ قرض‌الحسنه بدون سود (۰٪) هستند.
- **ذخیره و سوخت نکول**: اقساط وصول‌نشده از ورودی نقد کسر می‌شوند؛ هم‌زمان ذخیرهٔ زیان موردانتظار (وام × نکول × LGD) در ماه
  اعطا به‌صورت غیرنقدی در حاشیه شناسایی و اصل وصول‌نشده پس از سررسید آخرین قسط + مهلت سوخت، از مانده تسهیلات خارج می‌شود.
  نرخ نکول صفر (پیش‌فرض هر سه نمونه) این لایه را کاملاً خنثی نگه می‌دارد.
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
- **شکاف سررسید (WAL)**: سمت تعهدات روی همان خروجی نردبان (`برداشت + سود پرداختی سپرده + ماندهٔ زندهٔ افق`) وزن می‌شود.
  پیش‌تر سود سپرده از این میانگین کنار گذاشته می‌شد و در طرح‌های دارای سود (نمونهٔ سوم) عمر تعهدات حدود یک ماه کوتاه‌تر
  و شکاف سررسید بزرگ‌تر از نمودارِ همان کارت نشان داده می‌شد.
- **اندازهٔ سطل زمانی**: یک قاعدهٔ مشترک در `src/lib/buckets.ts` برای نردبان سررسید و نقشهٔ حرارتی، بر پایهٔ **افق**
  (شمارهٔ آخرین ماه) و نه تعداد ردیف‌ها. ردیف‌های موتور از ماه صفر شروع می‌شوند، پس استفاده از تعداد ردیف‌ها مرزها را
  یک ماه جابه‌جا می‌کرد و افق پیش‌فرض ۶۰ ماهه به‌جای سطل ۳ ماهه، سطل ۶ ماهه می‌گرفت.
- **اهرم ∞ و حاشیهٔ ∞**: هر دو نسبت، وقتی مخرجشان صفر می‌شود، بی‌نهایت **با علامت** برمی‌گردانند. عدد صفر در این حالت
  «ایمن» یا «سر‌به‌سر» به نظر می‌رسید در حالی که طرح می‌تواند کاملاً زیان‌ده باشد.
- **نمودار گردبادی**: کران‌های هر محرک دقیقاً همان مقادیر شبکهٔ آزمون بحران‌اند، پس نتیجهٔ آن با خانه‌های ماتریس
  دوبعدی سازگار است و هیچ عدد تازه‌ای به مدل اضافه نمی‌کند. اثر تعاملی دو متغیر در این نمودار دیده نمی‌شود.
- **جایگاه‌های سناریو (A/B/C)**: سنجه‌های جدول در لحظهٔ نمایش با موتور **بازمحاسبه** می‌شوند، نه از عکس لحظهٔ ذخیره؛
  پس پس از تغییر موتور، مقایسهٔ سناریوهای قدیمی هم با نسخهٔ جاری سازگار می‌ماند. ضرایب LCR/NSFR تنظیمات تحلیل‌اند و
  با تعویض سناریو عوض نمی‌شوند.
- **بهینه‌یاب**: جست‌وجوی مختصاتی است، نه تضمین بهینهٔ سراسری. اگر هیچ طرحی همهٔ قیدها را برآورده نکند، کم‌نقض‌ترین طرح
  (بر پایهٔ «شدت نقض» نمایش‌داده‌شده در جدول) پیشنهاد می‌شود و عنوان کارت به «کم‌نقض‌ترین طرح یافت‌شده» تغییر می‌کند تا
  با «طرح بهینه» اشتباه گرفته نشود؛ دکمهٔ اعمال تا اجرای مجدد (پس از تغییر ورودی) غیرفعال می‌ماند.
- **نمونه طرح سوم**: یک نردبان ۱۲ پله‌ای هم‌راستاست — انتظار ۳ تا ۱۲ ماه، بازپرداخت ۱۲ تا ۶۰ ماه، نرخ مصوب ۵٪ تا ۲۳٪ و
  ضریب برابری ۶۰٪ تا ۱۲۰٪، همه رو به بالا. تنها ستون نزولی «سهم تخصیص» است (۱۱٫۰۹٪ → ۵٫۵۶٪) و این عمدی است: پله‌های
  کوتاه‌مدت زودتر نقد می‌شوند، پس کسری نقدینگی و هزینهٔ تأمین بین‌بانکی کمتر می‌شود. نتیجه: حاشیهٔ خالص ≈+۵٫۱۰ میلیارد
  ریال، حفرهٔ نقدینگی ۴۳٫۸۶٪ (زیر سقف ۴۵٪)، اهرم ۱٫۶۰، بازیابی ماه ۳۳ و ماندهٔ پایان افق ≈+۱۱٫۷۷ میلیارد ریال — تنها
  الگوی پیش‌فرض با حاشیهٔ مثبت و تنها الگویی که همهٔ قیدهای پیش‌فرض بهینه‌یاب را برآورده می‌کند.
  نرخ سود سپردهٔ آن ۰٫۱٪ است (عملاً صفر، مثل سپردهٔ جاری) و این از خودِ جدول نرخ نتیجه می‌شود: اگر نرخ سپرده از
  پله‌های ارزان جدول (۵٪، ۹٪، ۱۰٪…) بالاتر باشد، سود پرداختی به سپرده‌گذار از درآمد تسهیلات بیشتر می‌شود و طرح با
  *هر* چینش پله‌ای زیان‌ده می‌ماند، چون کف زیان همان سود سپرده است. اندازه‌گیری روی شبکهٔ α/تخصیص/چینش انتظار با نرخ
  ۲۰٫۵٪ کمینهٔ حفرهٔ ≈۷۱٪ و حاشیهٔ ≈−۱۳٫۷ میلیارد ریال می‌داد؛ آزمون `prices every step above the cost of funds`
  همین دام را نگهبانی می‌کند.
- **مونت‌کارلو**: مقیاس توزیع‌ها تعریف خود لغزندهٔ «شدت» است (در شدت ۱۰۰٪، σ نرخ‌ها ۲۰ واحد درصد و σ لگاریتمی حجم منابع ۲۵٪). شدت صفر اجرا را دقیقاً به شبیه‌سازی قطعی برمی‌گرداند.
- **فونت**: وزیرمتن متغیر به‌صورت محلی بسته‌بندی شده (مجوز OFL-1.1 در `src/assets/fonts/OFL.txt`) و در خروجی تک‌فایل درون‌خط می‌شود؛ برنامه برای نمایش فارسی به اینترنت نیاز ندارد.

</div>

> **Disclaimer:** This tool is for analytical and educational simulation only. Sample profiles are illustrative and
> do not describe a specific institution or guarantee eligibility, approval, or disbursement. It is **not** financial advice.

---

## 📄 License

Released under the [MIT License](./LICENSE).

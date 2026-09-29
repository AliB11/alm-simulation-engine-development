/* ------------------------------------------------------------------ *
 *  ALM Simulation Engine — Domain types
 *  تمامی نرخ‌ها به صورت «درصد» ذخیره می‌شوند (مثلاً ۸۰ یعنی ۸۰٪)
 *  تمامی مبالغ به «تومان» ذخیره می‌شوند و فقط در لایه نمایش به ریال تبدیل می‌گردند
 * ------------------------------------------------------------------ */

export type ContractType = 'qard' | 'murabaha';
export type Currency = 'toman' | 'rial';

/** تعریف یک پله (Tier) از محصول تسهیلاتی امتیازی */
export interface Tier {
  id: string;
  name: string;
  /** دوره ماندگاری / انتظار سپرده (ماه) — ۱ تا ۱۲ */
  tDep: number;
  /** دوره بازپرداخت تسهیلات (ماه) — ۶ تا ۶۰ */
  tLoan: number;
  /** ضریب برابری اعطای تسهیلات به میانگین (درصد) */
  alpha: number;
  /** حداقل میانگین مانده حساب (تومان) */
  minBalance: number;
  /** سهم این پله از کل سپرده جذب‌شده (درصد) */
  allocation: number;
  /** نرخ اختصاصی کارمزد/سود پله؛ null یعنی استفاده از نرخ سراسری */
  rateOverride: number | null;
}

export interface GlobalConfig {
  contractType: ContractType;
  /** نرخ کارمزد سالانه قرض‌الحسنه (درصد) */
  qardFeeRate: number;
  /** نرخ سود سالانه مرابحه (درصد) */
  murabahaRate: number;
  /** نرخ سپرده قانونی بانک مرکزی RR (درصد) */
  reserveRatio: number;
  /** سقف فردی اعطای تسهیلات (تومان) — صفر یعنی بدون سقف */
  loanCap: number;
  /** افق شبیه‌سازی (ماه) */
  horizon: number;
  /** مانده نقدینگی اولیه خزانه پیش از ورود منابع (تومان) */
  initialLiquidity: number;
  /** آزادسازی سپرده قانونی متناظر با برداشت سپرده */
  releaseReserve: boolean;
  /** نرخ نکول / معوقات اقساط (درصد) */
  defaultRate: number;
  /** زیان در صورت نکول LGD (درصد) — سهمی از اصل وصول‌نشده که ذخیره و سپس سوخت می‌شود؛ مابقی قابل‌بازیافت فرض می‌شود */
  lgdRate: number;
  /** مهلت سوخت اصل وصول‌نشده پس از سررسید آخرین قسط قراردادی (ماه) */
  writeOffLag: number;
  /** نرخ بازار بین‌بانکی برای برآورد هزینه پوشش کسری (درصد سالانه) */
  interbankRate: number;
  /** نرخ هزینه فرصت سپرده برای مشتری (درصد سالانه) */
  opportunityRate: number;
  /** نرخ سود سالانهٔ پرداختی بانک روی مانده سپرده‌ها (درصد) — صفر یعنی خنثی (سپردهٔ قرض‌الحسنه بدون سود) */
  depositProfitRate: number;
}

export interface Behavior {
  /** کل منابع جذب‌شده (تومان) */
  totalDeposit: number;
  /** میانگین سپرده هر مشتری (تومان) — برای اعمال سقف فردی */
  avgTicket: number;
  /** ρ_take نرخ تقاضای وام */
  takeUpRate: number;
  /** ρ_app نرخ قبولی اعتبارسنجی */
  approvalRate: number;
  /** ω_with نرخ خروج سپرده وام‌گیرندگان */
  runoffRate: number;
  /** ω_churn نرخ خروج سپرده انصراف‌دهندگان */
  churnRate: number;
}

export type ScheduleMode = 'lump' | 'uniform' | 'custom';

export interface CustomVintage {
  id: string;
  month: number;
  share: number;
}

export interface DepositSchedule {
  mode: ScheduleMode;
  uniformMonths: number;
  custom: CustomVintage[];
}

export interface SimInput {
  config: GlobalConfig;
  tiers: Tier[];
  behavior: Behavior;
  schedule: DepositSchedule;
}

/** یک ویژه (Vintage/Cohort) ورود منابع */
export interface Vintage {
  month: number;
  amount: number;
}

export type EventType = 'deposit' | 'reserve' | 'release' | 'pmt' | 'loan' | 'withdrawal' | 'profit';

/** تراکنش تجمیع‌شده یک ماه به تفکیک نوع رویداد و پله */
export interface FlowEvent {
  type: EventType;
  tierId: string;
  tierName: string;
  tierIndex: number;
  amount: number;
  vintages: number;
  vintageFrom: number;
  vintageTo: number;
  instFrom?: number;
  instTo?: number;
  instTotal?: number;
}

/** یک سطر از ماتریس جریان وجوه نقد */
export interface MonthRow {
  t: number;
  depositGross: number;
  reserveHeld: number;
  depositNet: number;
  pmtInflow: number;
  principalIn: number;
  incomeIn: number;
  reserveRelease: number;
  inflow: number;
  loanOut: number;
  withdrawalOut: number;
  /** سود پرداختی به سپرده‌گذاران در این ماه (روی میانگین ماندهٔ ماهانه) */
  profitPaid: number;
  /** هزینهٔ تأمین کسری نقدینگی از بازار بین‌بانکی در این ماه */
  fundingCost: number;
  /** هزینهٔ ذخیره مطالبات مشکوک‌الوصول در این ماه (غیرنقدی — فقط در حاشیه اثر دارد، نه در نقدینگی) */
  provisionCost: number;
  /** سوخت اصل وصول‌نشده از مانده تسهیلات در این ماه (غیرنقدی — کاهش‌دهندهٔ مانده تسهیلات) */
  writeOff: number;
  outflow: number;
  ncf: number;
  cum: number;
  depositBalance: number;
  loanBook: number;
  /** حاشیهٔ تجمعی بانک: Σ(درآمد کارمزد/سود − سود سپرده − هزینهٔ تأمین کسری) */
  cumMargin: number;
  events: FlowEvent[];
}

export interface TierResult {
  tier: Tier;
  index: number;
  share: number;
  deposit: number;
  alphaEff: number;
  capBinding: boolean;
  repBalance: number;
  /** آیا میانگین سپرده مشتری به حداقل مانده این پله می‌رسد؟ */
  eligible: boolean;
  /** آیا این پله اساساً تسهیلاتی اعطا می‌کند؟ (واجد شرایط و α_eff > ۰) */
  lends: boolean;
  rate: number;
  commitment: number;
  withdrawal: number;
  monthlyPmt: number;
  totalRepay: number;
  totalIncome: number;
  borrowers: number;
  firstMaturity: number | null;
  lastMaturity: number | null;
  lastPayment: number | null;
  unitPay: number;
}

export interface SimKpis {
  totalDeposit: number;
  netDeposit: number;
  reserveHeld: number;
  totalCommitment: number;
  totalWithdrawal: number;
  leverage: number;
  minCum: number;
  minCumMonth: number;
  maxHole: number;
  tippingPoint: number | null;
  recoveryMonth: number | null;
  deficitMonths: number;
  endCum: number;
  totalPmtInHorizon: number;
  totalIncomeInHorizon: number;
  pmtBeyondHorizon: number;
  commitmentsBeyondHorizon: number;
  interbankCost: number;
  borrowers: number;
  peakOutflow: number;
  peakOutflowMonth: number;
  /** Σ سود پرداختی به سپرده‌گذاران در افق */
  totalProfitPaid: number;
  /** درآمد خالص کارمزد/سود: درآمد وصولی − سود پرداختی سپرده */
  netInterestIncome: number;
  /** Σ هزینهٔ ذخیره مطالبات مشکوک‌الوصول در افق (غیرنقدی) */
  totalProvision: number;
  /** Σ سوخت اصل وصول‌نشده از مانده تسهیلات در افق (غیرنقدی) */
  totalWriteOff: number;
  /** حاشیهٔ خالص پس از هزینهٔ تأمین کسری از بازار بین‌بانکی و هزینهٔ ذخیره مطالبات */
  netMargin: number;
  /**
   * حاشیهٔ خالص به‌درصد منابع ورودی خالص. اگر منابع خالص صفر باشد
   * (مثلاً `RR = ۱۰۰٪`)، ±بی‌نهایت با علامت حاشیه برمی‌گردد — نه صفر،
   * چون صفر در این حالت به‌اشتباه «سر‌به‌سر» خوانده می‌شود.
   */
  marginOnNetDeposit: number;
}

export interface SimResult {
  rows: MonthRow[];
  tiers: TierResult[];
  kpis: SimKpis;
  vintages: Vintage[];
}

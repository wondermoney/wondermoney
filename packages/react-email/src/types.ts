export interface BudgetThresholdItemBase {
  budgetName: string;
  categoryName: string;
  formattedPercentageUsed: string;
  formattedSpent: string;
  formattedBudgeted: string;
  formattedRemainingOrOver: string;
}

export type BudgetThresholdItem =
  | (BudgetThresholdItemBase & { state: "near"; threshold: 80 })
  | (BudgetThresholdItemBase & { state: "at_limit"; threshold: 100 })
  | (BudgetThresholdItemBase & { state: "over"; threshold: 100 });

export interface BudgetThresholdAlertProps {
  /** Instance name (the API's `INSTANCE_NAME`) printed in the copy, header and footer; defaults to WonderMoney. */
  brandName?: string;
  /** Copy language; defaults to `'pt'` for backward compatibility. */
  language?: TransactionalEmailLanguage;
  firstName?: string;
  periodLabel: string;
  items: BudgetThresholdItem[];
  ctaUrl: string;
  settingsUrl: string;
  privacyUrl: string;
  unsubscribeUrl: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

export interface WeeklyBudgetSummary {
  status: "within_plan" | "near" | "over";
  withinPlanCount?: number;
  nearCount?: number;
  overCount?: number;
}

export interface WeeklyInsightsProps {
  /** Instance name (the API's `INSTANCE_NAME`) printed in the copy, header and footer; defaults to WonderMoney. */
  brandName?: string;
  /** Copy language; defaults to `'pt'` for backward compatibility. */
  language?: TransactionalEmailLanguage;
  firstName?: string;
  weekDateRange: string;
  formattedTotalSpending: string;
  previousWeekComparisonText?: string;
  previousWeekComparisonValue?: string;
  topCategoryDisplay: string;
  formattedTopCategoryAmount: string;
  budgetSummary?: WeeklyBudgetSummary;
  dataContext: string;
  ctaUrl: string;
  settingsUrl: string;
  privacyUrl: string;
  unsubscribeUrl: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

export interface MonthlyStoryCategoryDelta {
  categoryName: string;
  direction: "increase" | "decrease";
  formattedBaselineAmount: string;
  formattedDelta: string;
  formattedSubjectAmount: string;
}

export interface MonthlyStoryRecurringChange {
  displayName: string;
  formattedNewAmount: string;
  formattedPreviousAmount?: string;
  kind: "new" | "changed";
}

export interface MonthlyStoryMetric {
  detail?: string;
  formattedBaseline?: string;
  formattedValue: string;
  label: string;
  tone?: "positive" | "negative" | "neutral";
}

export interface MonthlyStoryDataSufficientProps {
  /** Instance name (the API's `INSTANCE_NAME`) printed in the copy, header and footer; defaults to WonderMoney. */
  brandName?: string;
  budgetPressureDetail?: string;
  budgetPressureStatus?: string;
  categoryDeltas: MonthlyStoryCategoryDelta[];
  ctaUrl: string;
  firstName?: string;
  formattedIncomeBaseline: string;
  formattedIncomeSubject: string;
  formattedSpendingBaseline: string;
  formattedSpendingSubject: string;
  language: TransactionalEmailLanguage;
  monthLabel: string;
  narrativeSentences: string[];
  netWorthMetric?: MonthlyStoryMetric;
  privacyUrl: string;
  recurringChanges: MonthlyStoryRecurringChange[];
  savingsRateMetric?: MonthlyStoryMetric;
  settingsUrl: string;
  status: "sufficient";
  unsubscribeUrl: string;
}

export interface MonthlyStoryInsufficientDataProps {
  /** Instance name (the API's `INSTANCE_NAME`) printed in the copy, header and footer; defaults to WonderMoney. */
  brandName?: string;
  ctaUrl: string;
  firstName?: string;
  formattedIncomeSubject?: string;
  formattedSpendingSubject?: string;
  language: TransactionalEmailLanguage;
  monthLabel: string;
  monthsAvailable: number;
  monthsNeeded: number;
  privacyUrl: string;
  reason: "insufficient_history" | "zero_activity";
  settingsUrl: string;
  status: "insufficient";
  unsubscribeUrl: string;
}

export type MonthlyStoryProps = MonthlyStoryDataSufficientProps | MonthlyStoryInsufficientDataProps;

export type TransactionalEmailLanguage = "en" | "pt";

/** "New bank connected" confirmation sent after an account sync links a bank. Transactional. */
export interface AccountConnectedEmailProps {
  /** Instance name (the API's `INSTANCE_NAME`) printed in the copy, header and footer; defaults to WonderMoney. */
  brandName?: string;
  language: TransactionalEmailLanguage;
  firstName?: string;
  /** Display name of the bank that was connected. */
  bankName: string;
  /** Absolute https link to the accounts dashboard. */
  dashboardUrl: string;
}

export interface InternalAlertDetail {
  label: string;
  value: string;
}

/**
 * Internal operational notifications sent to a team inbox (info@/alerts@/support@).
 * English-only by design — the recipient is the WonderMoney team, not a user.
 */
export interface InternalAlertEmailProps {
  /** Email subject; echoed back by the renderer so the caller keeps a single source of truth. */
  subject: string;
  /** Accent + eyebrow: `info` (neutral notifications) or `warning` (errors needing attention). */
  variant?: "info" | "warning";
  title: string;
  /** Optional lead sentence or free-form message body (e.g. a support message, an error string). */
  intro?: string;
  /** Structured key/value rows rendered as a details table. */
  details?: InternalAlertDetail[];
}

/**
 * Reusable branded shell for opt-out-able lifecycle nudges, such as the bank-recovery
 * nudge. The per-step copy is supplied by the caller so this stays a single template.
 * Carries a one-click unsubscribe footer.
 */
export interface LifecycleNudgeEmailProps {
  /** Instance name (the API's `INSTANCE_NAME`) printed in the copy, header and footer; defaults to WonderMoney. */
  brandName?: string;
  language: TransactionalEmailLanguage;
  /** Email subject; echoed back by the renderer. */
  subject: string;
  /** Inbox preview text; defaults to the first body paragraph. */
  preheader?: string;
  firstName?: string;
  heading: string;
  /** One or more body paragraphs, already localized by the caller. */
  body: string[];
  /** Optional step-by-step visual rendered after the first body paragraph. */
  steps?: { label: string; detail?: string }[];
  ctaLabel?: string;
  /** Absolute https action link (e.g. reopen app / retry connection). */
  ctaUrl?: string;
  /** Absolute https one-click unsubscribe link (also sent as List-Unsubscribe by the API). */
  unsubscribeUrl: string;
  /** Optional absolute https link to notification settings. */
  settingsUrl?: string;
  /** Overrides the default "you're receiving this as part of your account" footer line (e.g. for a recipient without an account). */
  footerNote?: string;
}

export const GOOGLE_TAG_MANAGER_ID = "GTM-MGJJLRNH";

export const RETENTION_GROWTH_EVENTS = {
  profileCompletenessViewed: "profile_completeness_viewed",
  profileCompletenessItemClicked: "profile_completeness_item_clicked",
  insightCardViewed: "insight_card_viewed",
  insightCardClicked: "insight_card_clicked",
  insightCardDismissed: "insight_card_dismissed",
  weeklyDigestSent: "weekly_digest_sent",
  weeklyDigestOpened: "weekly_digest_opened",
  weeklyDigestClicked: "weekly_digest_clicked",
} as const;

export type RetentionGrowthEventName =
  (typeof RETENTION_GROWTH_EVENTS)[keyof typeof RETENTION_GROWTH_EVENTS];

/**
 * Engagement events fired from core product surfaces. Captured at every
 * occurrence (no dedupe). Property shapes are documented inline at the
 * call site — see the analytics dashboards for what's expected.
 */
export const ENGAGEMENT_EVENTS = {
  // Banking transactions
  transactionAdded: "transaction_added",
  transactionCategorized: "transaction_categorized",
  transactionCategoryEdited: "transaction_category_edited",
  transactionViewed: "transaction_viewed",
  firstTransactionViewed: "first_transaction_viewed",
  // Accounts
  accountViewed: "account_viewed",
  accountAddedManual: "account_added_manual",
  // Budgets
  budgetViewed: "budget_viewed",
  budgetCreated: "budget_created",
  budgetEdited: "budget_edited",
  budgetDeleted: "budget_deleted",
  // Portfolio
  portfolioCreated: "portfolio_created",
  portfolioTransactionAdded: "portfolio_transaction_added",
  portfolioTransactionsFiltered: "portfolio_transactions_filtered",
  portfolioTransactionsImported: "portfolio_transactions_imported",
  portfolioHoldingViewed: "portfolio_holding_viewed",
  // Reports / insights
  reportViewed: "report_viewed",
  insightViewed: "insight_viewed",
  // Search
  searchUsed: "search_used",
  // Feature interest
  featureInterestExpressed: "feature_interest_expressed",
} as const;

export type EngagementEventName =
  (typeof ENGAGEMENT_EVENTS)[keyof typeof ENGAGEMENT_EVENTS];

/**
 * Lifecycle / messaging events. Notification surfaces.
 */
export const LIFECYCLE_EVENTS = {
  notificationReceived: "notification_received",
  notificationOpened: "notification_opened",
} as const;

export type LifecycleEventName =
  (typeof LIFECYCLE_EVENTS)[keyof typeof LIFECYCLE_EVENTS];

export const ACTIVATION_EVENTS = {
  signupSubmitClicked: "signup_submit_clicked",
  signupSubmitSucceeded: "signup_submit_succeeded",
  signupSubmitFailed: "signup_submit_failed",
  onboardingStarted: "onboarding_started",
  onboardingStepViewed: "onboarding_step_viewed",
  onboardingStepCompleted: "onboarding_step_completed",
  onboardingCompleted: "onboarding_completed",
  firstAccountAdded: "first_account_added",
  dashboardFirstViewed: "dashboard_first_viewed",
  firstNetWorthRendered: "first_net_worth_rendered",
} as const;

export type ActivationEventName =
  (typeof ACTIVATION_EVENTS)[keyof typeof ACTIVATION_EVENTS];

export type ActivationEventDedupePolicy =
  | "action"
  | "session"
  | "step_view"
  | "user";

export const ACTIVATION_EVENT_DEDUPE_POLICIES = {
  [ACTIVATION_EVENTS.signupSubmitClicked]: "action",
  [ACTIVATION_EVENTS.signupSubmitSucceeded]: "action",
  [ACTIVATION_EVENTS.signupSubmitFailed]: "action",
  [ACTIVATION_EVENTS.onboardingStarted]: "user",
  [ACTIVATION_EVENTS.onboardingStepViewed]: "step_view",
  [ACTIVATION_EVENTS.onboardingStepCompleted]: "action",
  [ACTIVATION_EVENTS.onboardingCompleted]: "user",
  [ACTIVATION_EVENTS.firstAccountAdded]: "user",
  [ACTIVATION_EVENTS.dashboardFirstViewed]: "session",
  [ACTIVATION_EVENTS.firstNetWorthRendered]: "user",
} as const satisfies Record<ActivationEventName, ActivationEventDedupePolicy>;

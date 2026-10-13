export const FIRST_RUN_ONBOARDING_STORAGE_KEY =
  "wondermoney:first-run-onboarding:v1";
export const FIRST_RUN_ONBOARDING_SUPPRESS_DRAWERS_KEY =
  "wondermoney:first-run-onboarding:suppress-existing-drawers-once";

export const FIRST_RUN_MAX_GOALS = 2;

export const FIRST_RUN_GOALS = [
  "all_in_one",
  "spending",
  "budget",
  "investments_net_worth",
  "financial_freedom",
  "exploring",
] as const;

export type FirstRunGoal = (typeof FIRST_RUN_GOALS)[number];

export const FIRST_RUN_STEPS = [
  "welcome",
  "goals",
  "privacy",
  "account",
  "sync_value",
  "completion",
] as const;

export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export const FIRST_RUN_STEP_ROUTES = {
  welcome: "/onboarding/welcome",
  goals: "/onboarding/goals",
  privacy: "/onboarding/privacy",
  account: "/onboarding/account",
  sync_value: "/onboarding/sync",
  completion: "/onboarding/complete",
} as const satisfies Record<FirstRunStep, string>;

export type FirstRunAccountStep =
  | "not_started"
  | "connected"
  | "manual_added"
  | "skipped";
export type FirstRunBudgetStep = "not_started" | "started" | "skipped";
export type FirstRunPortfolioStep = "not_started" | "started" | "skipped";
export type FirstRunHandoff = "account" | "budget" | "portfolio";

export interface FirstRunOnboardingState {
  status: "not_started" | "in_progress" | "completed";
  currentStep: FirstRunStep;
  selectedGoals: FirstRunGoal[];
  accountStep: FirstRunAccountStep;
  budgetStep: FirstRunBudgetStep;
  portfolioStep: FirstRunPortfolioStep;
  activeHandoff?: FirstRunHandoff;
  startedAt?: string;
  completedAt?: string;
}

export const FIRST_RUN_EVENTS = {
  started: "first_run_onboarding_started",
  stepViewed: "first_run_onboarding_step_viewed",
  goalsSelected: "first_run_goals_selected",
  accountConnectClicked: "first_run_account_connect_clicked",
  // RAD-600. Everything between picking a bank and the server-side sync used to
  // be unmeasured on this path: the Accounts-page flow emits
  // `account_add_sync_modal` / `account_add_sync_before_redirect` /
  // `first_account_added`, and first-run emitted none of them. When first-run
  // became the dominant route for new users the whole activation funnel went
  // dark, which is the one funnel that matters most here.
  accountRequisitionCreated: "first_run_account_requisition_created",
  accountRequisitionFailed: "first_run_account_requisition_failed",
  accountBeforeRedirect: "first_run_account_before_redirect",
  accountConnectReturned: "first_run_account_connect_returned",
  manualAccountClicked: "first_run_manual_account_clicked",
  stepSkipped: "first_run_step_skipped",
  accountSkipWarningViewed: "first_run_account_skip_warning_viewed",
  accountSkipConfirmed: "first_run_account_skip_confirmed",
  budgetCtaClicked: "first_run_budget_cta_clicked",
  portfolioCtaClicked: "first_run_portfolio_cta_clicked",
  completed: "first_run_onboarding_completed",
} as const;

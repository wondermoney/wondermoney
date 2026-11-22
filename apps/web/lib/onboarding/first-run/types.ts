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

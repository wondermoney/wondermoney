export const FIRST_RUN_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
] as const;

export const FIRST_RUN_ACCOUNT_STEPS = [
  "not_started",
  "connected",
  "manual_added",
  "skipped",
] as const;

export const FIRST_RUN_BUDGET_STEPS = [
  "not_started",
  "started",
  "skipped",
] as const;

export const FIRST_RUN_PORTFOLIO_STEPS = [
  "not_started",
  "started",
  "skipped",
] as const;

export const FIRST_RUN_HANDOFFS = ["account", "budget", "portfolio"] as const;

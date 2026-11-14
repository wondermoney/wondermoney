import type { BudgetVisibility } from "@/lib/budget/visibility";

export interface Budget {
  budgetKey: number;
  name: string;
  description?: string;
  /** The day of the month a budget month starts on, 1 to 28 (1: the calendar month). */
  periodStartDay?: number;
  /** Sent by `GET /v1/budget/:budgetKey`; not by the budget list. */
  rolloverCarriesOverspend?: boolean;
  /** Missing from older servers: read it through `budgetVisibilityOf`. */
  visibility?: BudgetVisibility;
}

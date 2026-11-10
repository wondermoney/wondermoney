import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import type { AmountsCompleteness } from "../completeness";

/** One expected date of a recurring item, in the budget's currency. A projection. */
export interface BudgetForecastOccurrence {
  amount: number;
  categoryKey: number;
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  recurringSeriesKey: number;
}

export interface BudgetForecastMonth {
  year: number;
  month: number;
  /** `current` has actual spending so far; `future` is projected only. */
  kind: "current" | "future";
  /** The month's plan. */
  budgeted: number;
  /**
   * What rollover carries in: in the current month the carry the budget
   * month shows; later, a projected overspend carried forward.
   */
  carriedIn: number;
  /** `budgeted + carriedIn`. */
  available: number;
  /** Actual spending so far; null for a future month, which has none. */
  spent: number | null;
  /** What recurring items are expected to take for the rest of the month. */
  projectedSpend: number;
  /**
   * Per category the plan, or more where spending so far plus the upcoming
   * recurring items exceed it.
   */
  expectedSpend: number;
  /** The budget's planned income. */
  income: number;
  /** `income - expectedSpend`. */
  net: number;
  /** False when some spending, carry or recurring item could not be converted. */
  complete: boolean;
  recurring: BudgetForecastOccurrence[];
}

export interface BudgetForecastRecurringItem {
  recurringSeriesKey: number;
  name: string;
  cadence: string;
  categoryKey: number;
  /** One occurrence, in the budget's currency. */
  amount: number;
  /** One occurrence, in the item's own currency. */
  originalAmount: number;
  currencyCode: string;
}

export interface GetBudgetForecastResponse {
  /** The UTC day the forecast was made: actual up to it, projected after. */
  asOf: string;
  budgetKey: number;
  currencyCode: SupportedCurrencyCodes;
  basis: {
    plannedIncome: { name: string; amount: number }[];
    recurringItems: BudgetForecastRecurringItem[];
  };
  completeness: AmountsCompleteness & { unconvertedRecurringItems: number };
  months: BudgetForecastMonth[];
}

export const BUDGET_FORECAST_MONTHS = [3, 6, 12] as const;
export type BudgetForecastMonths = (typeof BUDGET_FORECAST_MONTHS)[number];

export interface GetBudgetForecastRequest {
  budgetKey: number;
  months: BudgetForecastMonths;
}

export async function getBudgetForecast(
  params: GetBudgetForecastRequest,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetForecastResponse> {
  const { data } = await apiClient.get<GetBudgetForecastResponse>(
    `/v1/budget/${params.budgetKey}/forecast`,
    { params: { months: params.months } },
  );
  return data;
}

/**
 * Under the budget's own key, so `invalidateBudgets` (which invalidates
 * `["budget"]`) refreshes it after any budget edit.
 */
const budgetForecastKey = ({
  budgetKey,
  months,
}: GetBudgetForecastRequest) =>
  ["budget", budgetKey, "forecast", months] as const;

export default function useBudgetForecast<R = GetBudgetForecastResponse>(
  params: GetBudgetForecastRequest,
  options?: Omit<
    UseQueryOptions<GetBudgetForecastResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: budgetForecastKey(params),
    queryFn: () => getBudgetForecast(params),
    ...options,
  });
}

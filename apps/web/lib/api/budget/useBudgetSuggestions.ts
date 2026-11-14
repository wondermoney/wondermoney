import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export interface BudgetSuggestion {
  /** Mean monthly spending across the complete months in the window. */
  average: number;
  categoryKey: number;
  categoryName: string;
  /** False when the category has fewer than two months of spending. */
  hasEnoughData: boolean;
  /** Median monthly spending across the complete months in the window. */
  median: number;
  monthsWithData: number;
  /** The median rounded up to the nearest 5, or null when there is nothing to suggest. */
  suggested: number | null;
}

export interface GetBudgetSuggestionsResponse {
  categories: BudgetSuggestion[];
  currencyCode: SupportedCurrencyCodes;
  months: number;
  targetMonth: { month: number; year: number };
}

export const BUDGET_SUGGESTION_MONTHS = [3, 6, 12] as const;
export type BudgetSuggestionMonths = (typeof BUDGET_SUGGESTION_MONTHS)[number];

export interface GetBudgetSuggestionsRequest {
  budgetKey: number;
  month: number;
  months?: BudgetSuggestionMonths;
  year: number;
}

export async function getBudgetSuggestions(
  params: GetBudgetSuggestionsRequest,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetSuggestionsResponse> {
  const { data } = await apiClient.get<GetBudgetSuggestionsResponse>(
    `/v1/budget/${params.budgetKey}/suggestions`,
    { params: { month: params.month, months: params.months ?? 3, year: params.year } },
  );
  return data;
}

const budgetSuggestionsKey = ({
  budgetKey,
  month,
  months = 3,
  year,
}: GetBudgetSuggestionsRequest) =>
  ["budget", budgetKey, "suggestions", year, month, months] as const;

export default function useBudgetSuggestions<R = GetBudgetSuggestionsResponse>(
  params: GetBudgetSuggestionsRequest,
  options?: Omit<
    UseQueryOptions<GetBudgetSuggestionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: budgetSuggestionsKey(params),
    queryFn: () => getBudgetSuggestions(params),
    ...options,
  });
}

import {
  useQueries,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import type { AmountsCompleteness } from "../completeness";

export interface BudgetCategory {
  child_category_name: string | null;
  parent_category_name: string;
  category_amount: number;
  category_recurrency: string | null;
  category_budgeted_amount: number;
  child_category_icon: string;
  child_category_text_color: string;
  child_category_bg_color: string;
  category_is_system_category: boolean;
  category_icon: string;
  category_text_color: string;
  category_bg_color: string;
  category_key: number;
  /**
   * Rollover fields: sent by the month endpoints (`/:year/:month`, `/full`),
   * absent from the year endpoint.
   *
   * What last month left over (negative when it overspent); 0 when rollover is
   * off or nothing carries. A parent row sums its subcategories'.
   */
  category_rolled_over?: number;
  /** `category_budgeted_amount + category_rolled_over`, on the raw (entered) amount. */
  category_available?: number;
  /** Rollover is on (a parent row: for any of its subcategories). */
  category_rollover_enabled?: boolean;
  /**
   * The carry rests on a month with spending that could not be converted to
   * the budget's currency, so it may be too high.
   */
  category_rollover_incomplete?: boolean;
}

export type BudgetIncome = {
  name: string;
  amount: number;
  recurrency: string;
};

export interface TemplateBudget {
  budgetKey: number;
  currencyCode: SupportedCurrencyCodes;
  name: string;
  description?: string;
  month: number;
  year: number;
  accounts: {
    accountKey: number;
    accountName: string;
  }[];
  categories: BudgetCategory[];
  incomes: BudgetIncome[];
  /** Overspending carries into the next month (off: only unspent money does). */
  rolloverCarriesOverspend?: boolean;
}

export interface GetBudgetTemplateByYearAndMonthResponse {
  hasPreviousMonth: boolean;
  hasNextMonth: boolean;
  budget: TemplateBudget;
  /** False when a carried amount rests on spending that could not be converted. */
  rolloverComplete?: boolean;
  /** Rows with no amount in the budget's currency, left out of the spending. */
  completeness?: AmountsCompleteness;
}

export interface GetBudgetTemplateByYearAndMonthRequest {
  budgetKey: number;
  month: number;
  year: number;
}

export async function getBudgetTemplateByYearAndMonth(
  params: GetBudgetTemplateByYearAndMonthRequest,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetTemplateByYearAndMonthResponse> {
  const { data } = await apiClient.get<GetBudgetTemplateByYearAndMonthResponse>(
    `/v1/budget/${params.budgetKey}/${params.year}/${params.month}`,
  );
  return data;
}

const budgetTemplateByYearAndMonthKey = ({
  budgetKey,
  month,
  year,
}: GetBudgetTemplateByYearAndMonthRequest) =>
  ["budget-template-year-month", budgetKey, month, year] as const;

export default function useBudgetTemplateByYearAndMonth<
  R = GetBudgetTemplateByYearAndMonthResponse,
>(
  params: GetBudgetTemplateByYearAndMonthRequest,
  options?: Omit<
    UseQueryOptions<GetBudgetTemplateByYearAndMonthResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: budgetTemplateByYearAndMonthKey(params),
    queryFn: () => getBudgetTemplateByYearAndMonth(params),
    ...options,
  });
}

/**
 * One month of several budgets, fetched in parallel under the same keys as
 * {@link useBudgetTemplateByYearAndMonth}, so a budget's month screen opens
 * from the cache this fills. The results keep the order of `params`.
 */
export function useBudgetTemplatesByYearAndMonth(
  params: GetBudgetTemplateByYearAndMonthRequest[],
) {
  return useQueries({
    queries: params.map((request) => ({
      queryKey: budgetTemplateByYearAndMonthKey(request),
      queryFn: () => getBudgetTemplateByYearAndMonth(request),
    })),
  });
}

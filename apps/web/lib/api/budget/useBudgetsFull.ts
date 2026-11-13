import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { BudgetPeriod } from "@/lib/budget/period";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import type {
  BudgetCategory,
  BudgetIncome,
} from "./useBudgetTemplateByYearAndMonth";

export interface BudgetFull {
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
  /** The days of the budget month shown (`month`/`year`: the one today is in). */
  period: BudgetPeriod;
  /** The day of the month a budget month starts on, 1 to 28 (1: the calendar month). */
  periodStartDay: number;
  /** Overspending carries into the next month (off: only unspent money does). */
  rolloverCarriesOverspend: boolean;
  /** False when a carried amount rests on spending that could not be converted. */
  rolloverComplete: boolean;
}

export interface GetBudgetsFullResponse {
  budgets: BudgetFull[];
}

export interface GetBudgetsFullRequest {
  /**
   * The member filter (`lib/household/member-attribution.ts`): spending counts only that
   * member's (or Shared) transactions. Absent for everyone.
   */
  memberKeys?: string[];
}

/**
 * Fetches all budgets with full details from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 * @param params - Optional member filter.
 */
export async function getBudgetsFull(
  apiClient: AxiosInstance = api,
  params: GetBudgetsFullRequest = {},
): Promise<GetBudgetsFullResponse> {
  const { data } = await apiClient.get<GetBudgetsFullResponse>(
    `/v1/budget/full`,
    params.memberKeys?.length
      ? { params: { memberKeys: params.memberKeys.join(",") } }
      : undefined,
  );
  return data;
}

export default function useBudgetsFull<R = GetBudgetsFullResponse>(
  options?: Omit<
    UseQueryOptions<GetBudgetsFullResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
  params: GetBudgetsFullRequest = {},
) {
  const memberKeys = params.memberKeys?.length ? params.memberKeys : undefined;
  return useQuery({
    // Everyone keeps the plain key, so its cache and invalidation are as before.
    queryKey: memberKeys ? ["budgets-full", { memberKeys }] : ["budgets-full"],
    queryFn: () => getBudgetsFull(undefined, { memberKeys }),
    ...options,
  });
}

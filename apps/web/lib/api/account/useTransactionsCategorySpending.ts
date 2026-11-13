import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AmountsCompleteness } from "../completeness";
import { transactionDateRangeParams } from "../date-range";

interface CategorySpending {
  categoryKey: number;
  amount: number;
  currency?: string;
  icon?: string | undefined;
  bgColor: string;
  textColor: string;
  isSystemCategory: boolean;
  numTransactions: number;
  name: string;
}

export interface CategoriesSpending extends CategorySpending {
  childCategories: CategorySpending[];
}

/** Amounts in the viewer's currency (`completeness.currencyCode`). */
export interface GetTransactionsCategorySpendingResponse {
  categorySpending: CategoriesSpending[];
  /** The expenses left out because no exchange rate converts them. */
  completeness?: AmountsCompleteness;
}

export interface GetTransactionsCategorySpendingRequest {
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  /** The member filter (`lib/household/member-attribution.ts`); absent for everyone. */
  memberKeys?: string[];
}

/**
 * Fetches category spending data from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Query parameters for filtering category spending
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getTransactionsCategorySpending(
  params: GetTransactionsCategorySpendingRequest = {},
  apiClient: AxiosInstance = api,
): Promise<GetTransactionsCategorySpendingResponse> {
  const { memberKeys, ...rest } = params;
  const _params = {
    ...rest,
    ...transactionDateRangeParams(params),
    ...(memberKeys?.length ? { memberKeys: memberKeys.join(",") } : {}),
  };
  const { data } = await apiClient.get<GetTransactionsCategorySpendingResponse>(
    "/v1/account/transaction/category-spending",
    {
      params: _params,
    },
  );
  return data;
}

export default function useTransactionsCategorySpending<
  R = GetTransactionsCategorySpendingResponse,
>(
  params?: GetTransactionsCategorySpendingRequest,
  options?: Omit<
    UseQueryOptions<GetTransactionsCategorySpendingResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["transactions-category-spending", params],
    queryFn: () => getTransactionsCategorySpending(params),
    ...options,
  });
}

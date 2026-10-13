import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { format } from "date-fns";

import api from "../api";

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

export interface GetTransactionsCategorySpendingResponse {
  categorySpending: CategoriesSpending[];
}

export interface GetTransactionsCategorySpendingRequest {
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
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
  const _params = {
    ...params,
    ...(params.fromDate && { fromDate: format(params.fromDate, "yyyy-MM-dd") }),
    ...(params.toDate && { toDate: format(params.toDate, "yyyy-MM-dd") }),
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

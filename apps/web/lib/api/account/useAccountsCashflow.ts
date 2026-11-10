import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AmountsCompleteness } from "../completeness";
import { transactionDateRangeParams } from "../date-range";

export interface AccountCashflow {
  date: string;
  amount: number;
  /** Money in for the month, in the viewer's currency. */
  income: number;
  /** Money out for the month, as a positive amount. */
  expenses: number;
  /** `(income - expenses) / income`; null when the month has no income. */
  savingsRate: number | null;
}

export interface GetAccountsCashflowRequest {
  fromDate?: Date;
  toDate?: Date;
}

export type GetAccountsCashflowResponse = {
  cashflow: AccountCashflow[];
  /** Rows with no amount in the user's currency, left out of `cashflow`. */
  completeness?: AmountsCompleteness;
};

export async function getAccountsCashflow(
  params: GetAccountsCashflowRequest,
  apiClient: AxiosInstance = api,
): Promise<GetAccountsCashflowResponse> {
  // Without a start, months run from the first transaction.
  const _params = transactionDateRangeParams({
    fromDate: params.fromDate,
    toDate: params.toDate,
  });
  const { data } = await apiClient.get<GetAccountsCashflowResponse>(
    "/v1/account/cashflow",
    {
      params: _params,
    },
  );
  return data;
}

export default function useAccountsCashflow<R = GetAccountsCashflowResponse>(
  params: GetAccountsCashflowRequest,
  options?: Omit<
    UseQueryOptions<GetAccountsCashflowResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["accounts-cashflow", params],
    queryFn: () => getAccountsCashflow(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}

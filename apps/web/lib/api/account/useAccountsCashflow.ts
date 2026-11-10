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
}

export interface GetAccountsCashflowRequest {
  fromDate?: Date;
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
  // The endpoint takes a start only: months run to the latest transaction.
  const _params = transactionDateRangeParams({ fromDate: params.fromDate });
  const { data } = await apiClient.get<GetAccountsCashflowResponse>(
    "/v1/account/cashflow",
    {
      params: _params,
    },
  );
  return data;
}

export default function useAccountsCashflow<R = GetAccountsCashflowResponse>(
  params: { fromDate?: Date },
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

import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { format } from "date-fns";

import api from "../api";

export interface AccountCashflow {
  date: string;
  amount: number;
}

export interface GetAccountsCashflowRequest {
  fromDate?: Date;
}

export type GetAccountsCashflowResponse = {
  cashflow: AccountCashflow[];
};

export async function getAccountsCashflow(
  params: GetAccountsCashflowRequest,
  apiClient: AxiosInstance = api,
): Promise<GetAccountsCashflowResponse> {
  const _params = params.fromDate
    ? { fromDate: format(params.fromDate, "yyyy-MM-dd") }
    : {};
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

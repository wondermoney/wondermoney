import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { format } from "date-fns";

import api from "../api";
import type { Transaction } from "./useTransactions";

export interface GetAccountTransactionsResponse {
  transactions: Transaction[];
  /**
   * Rows matching the filters, before `limit`. Optional because a client can be newer
   * than the API it is talking to; readers fall back to counting loaded rows.
   */
  total?: number;
  limit?: number;
  hasMore?: boolean;
}

export interface GetAccountTransactionsRequest {
  unreviewedOnly?: boolean;
  fromDate?: Date;
  toDate?: Date;
  accountId?: number | string;
  limit?: number;
  /**
   * Filtered server-side, not in the browser over the loaded page (which would filter only
   * whichever 100 rows came back). No `accountKeys`: this endpoint is already scoped to one
   * account and the page hides that filter.
   */
  transactionTypes?: string[];
  categoryKeys?: string[];
}

export async function getAccountTransactions(
  params: GetAccountTransactionsRequest = {},
  apiClient: AxiosInstance = api,
): Promise<GetAccountTransactionsResponse> {
  // The path accountId is authoritative; the api tolerates but does not need
  // a redundant ?accountId= query. Strip it from the request envelope so
  // the web doesn't send a value the server ignores.
  const { accountId: _ignored, fromDate, toDate, ...rest } = params
  // An empty array means "no filter", not "match nothing", so it is dropped.
  const list = (values?: string[]) =>
    values && values.length > 0 ? values.join(",") : undefined;
  const _params = {
    ...rest,
    ...(fromDate && { fromDate: format(fromDate, "yyyy-MM-dd") }),
    ...(toDate && { toDate: format(toDate, "yyyy-MM-dd") }),
    categoryKeys: list(params.categoryKeys),
    transactionTypes: list(params.transactionTypes),
  };
  const { data } = await apiClient.get<GetAccountTransactionsResponse>(
    `/v1/account/${params.accountId}/transaction`,
    {
      params: _params,
    },
  );
  return data;
}

export default function useAccountTransactions<
  R = GetAccountTransactionsResponse,
>(
  params?: GetAccountTransactionsRequest,
  options?: Omit<
    UseQueryOptions<GetAccountTransactionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["account-transactions", params],
    queryFn: () => getAccountTransactions(params),
    ...options,
  });
}

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import {
  type Account as CanonicalAccountSummary,
  normalizeAccountsResponse,
} from "./useAccounts";

export type AccountSummary = CanonicalAccountSummary;
export type Account = AccountSummary;

export interface GetAccountResponse {
  account: AccountSummary;
}

export function normalizeAccountResponse(response: unknown): GetAccountResponse {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new Error("Invalid account response");
  }

  const { accounts } = normalizeAccountsResponse({
    accounts: [(response as Record<string, unknown>).account],
  });

  return { account: accounts[0] };
}

export async function getAccount(
  accountId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetAccountResponse> {
  const { data } = await apiClient.get<unknown>(`/v1/account/${accountId}`);
  return normalizeAccountResponse(data);
}

export default function useAccount<R = GetAccountResponse>(
  accountId: number | string,
  options?: Omit<
    UseQueryOptions<GetAccountResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getAccount(accountId),
    ...options,
  });
}

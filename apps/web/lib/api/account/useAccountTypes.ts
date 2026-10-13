import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface AccountType {
  accountTypeKey: number;
  /** Seeded enum value, e.g. "CHECKING", "CREDIT_CARD" — see AccountTypeSeeder on the API. */
  description: string;
}

export interface GetAccountTypesResponse {
  accountTypes: AccountType[];
}

export async function getAccountTypes(
  apiClient: AxiosInstance = api,
): Promise<GetAccountTypesResponse> {
  const { data } = await apiClient.get<GetAccountTypesResponse>(
    "/v1/account/account-types",
  );
  return data;
}

export default function useAccountTypes<R = GetAccountTypesResponse>(
  options?: Omit<
    UseQueryOptions<GetAccountTypesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["account-types"],
    queryFn: () => getAccountTypes(),
    ...options,
  });
}

/**
 * Maps a seeded AccountType `description` (e.g. "CREDIT_CARD") to the matching
 * `account-type-*` translation key (e.g. "account-type-credit-card"), so new
 * seeded values still render something sensible instead of throwing.
 */
export function accountTypeTranslationKey(description: string): string {
  return `account-type-${description.toLowerCase().replace(/_/g, "-")}`;
}

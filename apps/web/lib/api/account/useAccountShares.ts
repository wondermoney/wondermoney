import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { HouseholdRole } from "@/lib/api/household/types";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

import api from "../api";

/** What a share grants: see the account (`read`) or also change it (`write`). */
export type AccountShareAccess = "read" | "write";

/** A member's effective access to the account, after the private flag, the share and the role. */
export type AccountMemberAccess = "hidden" | "owner" | "read" | "write";

export interface AccountShareMember {
  appuserKey: number;
  firstName: string | null;
  lastName: string | null;
  /** The member's household role; a viewer only ever reads. */
  role: HouseholdRole;
  isAccountOwner: boolean;
  /** The stored share, or null when there is none. */
  share: AccountShareAccess | null;
  access: AccountMemberAccess;
}

/** `GET` and `PUT /v1/account/:accountId/shares`. */
export interface AccountSharesResponse {
  accountKey: number;
  isPrivate: boolean;
  /** Whether the caller may change the sharing: the account owner or the household owner. */
  canManage: boolean;
  /** Every active household member, the account owner included. */
  members: AccountShareMember[];
}

/**
 * `isPrivate: false` shares the account with the whole household and takes no shares;
 * `isPrivate: true` hides it from everyone but its owner and the members listed.
 */
export interface UpdateAccountSharesRequest {
  isPrivate: boolean;
  shares: { appuserKey: number; access: AccountShareAccess }[];
}

export const accountSharesQueryKey = (accountKey: number | string) =>
  ["account", Number(accountKey), "shares"] as const;

export async function getAccountShares(
  accountKey: number | string,
  apiClient: Pick<AxiosInstance, "get"> = api,
): Promise<AccountSharesResponse> {
  const { data } = await apiClient.get<AccountSharesResponse>(
    `/v1/account/${accountKey}/shares`,
  );
  return data;
}

export async function updateAccountShares(
  accountKey: number | string,
  body: UpdateAccountSharesRequest,
  apiClient: Pick<AxiosInstance, "put"> = api,
): Promise<AccountSharesResponse> {
  const { data } = await apiClient.put<AccountSharesResponse>(
    `/v1/account/${accountKey}/shares`,
    body,
  );
  return data;
}

export default function useAccountShares<R = AccountSharesResponse>(
  accountKey: number | string,
  options?: Omit<
    UseQueryOptions<AccountSharesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: accountSharesQueryKey(accountKey),
    queryFn: () => getAccountShares(accountKey),
    ...options,
  });
}

/**
 * Saves who sees and edits the account. The private flag and access move what every list,
 * total and detail shows, so the account queries refetch as after any other account change.
 */
export function useUpdateAccountShares(accountKey: number | string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAccountSharesRequest) =>
      updateAccountShares(accountKey, body),
    onSuccess: async (data) => {
      queryClient.setQueryData(accountSharesQueryKey(accountKey), data);
      await invalidateAccounts(queryClient);
    },
  });
}

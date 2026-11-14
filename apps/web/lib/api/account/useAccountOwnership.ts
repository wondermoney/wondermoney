import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { HouseholdRole } from "@/lib/api/household/types";

import api from "../api";

export interface AccountOwnershipMember {
  appuserKey: number;
  /** Whether the member can see the account; only they can be given a share. */
  canSee: boolean;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  isAccountOwner: boolean;
  /** The member's share, 0 to 100 with up to two decimals; 0 when they hold none. */
  percent: number;
  role: HouseholdRole;
}

/** `GET` and `PUT /v1/account/:accountId/ownership`: each member's share in per-member net worth. */
export interface AccountOwnershipResponse {
  accountKey: number;
  /** Whether the caller may change the shares: the account owner or the household owner. */
  canManage: boolean;
  /** The part held by people no longer in the household, which counts as Shared. */
  formerMembersPercent: number;
  isJoint: boolean;
  /** False when the account is not split: it is its owner's, or Shared when joint. */
  isSplit: boolean;
  /** The members who can see the account or hold a share, the account owner first. */
  members: AccountOwnershipMember[];
}

/** The shares, adding up to 100; an empty list stops splitting the account. */
export type UpdateAccountOwnershipRequest = {
  appuserKey: number;
  percent: number;
}[];

export const accountOwnershipQueryKey = (accountKey: number | string) =>
  ["account", Number(accountKey), "ownership"] as const;

export async function getAccountOwnership(
  accountKey: number | string,
  apiClient: Pick<AxiosInstance, "get"> = api,
): Promise<AccountOwnershipResponse> {
  const { data } = await apiClient.get<AccountOwnershipResponse>(
    `/v1/account/${accountKey}/ownership`,
  );
  return data;
}

export async function updateAccountOwnership(
  accountKey: number | string,
  body: UpdateAccountOwnershipRequest,
  apiClient: Pick<AxiosInstance, "put"> = api,
): Promise<AccountOwnershipResponse> {
  const { data } = await apiClient.put<AccountOwnershipResponse>(
    `/v1/account/${accountKey}/ownership`,
    body,
  );
  return data;
}

export default function useAccountOwnership<R = AccountOwnershipResponse>(
  accountKey: number | string,
  options?: Omit<
    UseQueryOptions<AccountOwnershipResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: accountOwnershipQueryKey(accountKey),
    queryFn: () => getAccountOwnership(accountKey),
    ...options,
  });
}

/** Saves the shares. They move every member's net worth (and its history), never the household's. */
export function useUpdateAccountOwnership(accountKey: number | string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAccountOwnershipRequest) =>
      updateAccountOwnership(accountKey, body),
    onSuccess: async (data) => {
      queryClient.setQueryData(accountOwnershipQueryKey(accountKey), data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["net-worth"] }),
        queryClient.invalidateQueries({ queryKey: ["net-worth-history"] }),
      ]);
    },
  });
}

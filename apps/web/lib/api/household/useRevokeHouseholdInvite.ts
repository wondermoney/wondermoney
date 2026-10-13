import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type { HouseholdApiError } from "./types";

export interface HouseholdDeleteClient {
  delete: <T>(url: string) => Promise<{ data: T }>;
}

export async function revokeHouseholdInvite(
  householdInviteKey: number,
  apiClient: HouseholdDeleteClient = api,
): Promise<void> {
  await apiClient.delete<void>(`/v1/household/invites/${householdInviteKey}`);
}

type HouseholdCache = Pick<QueryClient, "invalidateQueries">;

export function getRevokeHouseholdInviteMutationOptions(
  queryClient: HouseholdCache,
  apiClient: HouseholdDeleteClient = api,
): UseMutationOptions<void, HouseholdApiError, number> {
  return {
    mutationFn: (householdInviteKey) =>
      revokeHouseholdInvite(householdInviteKey, apiClient),
    scope: { id: "household" },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: householdQueryKeys.all }),
  };
}

export default function useRevokeHouseholdInvite() {
  const queryClient = useQueryClient();
  return useMutation(getRevokeHouseholdInviteMutationOptions(queryClient));
}

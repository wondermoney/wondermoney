import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import type { HouseholdApiError } from "./types";

export interface HouseholdMemberDeleteClient {
  delete: <T>(url: string) => Promise<{ data: T }>;
}

export async function removeHouseholdMember(
  appuserKey: number,
  apiClient: HouseholdMemberDeleteClient = api,
): Promise<void> {
  await apiClient.delete<void>(`/v1/household/members/${appuserKey}`);
}

// Removing a member (or leaving) changes the whole shared picture — accounts,
// transactions, budgets, goals, portfolios — so invalidate every query.
type HouseholdCache = Pick<QueryClient, "invalidateQueries">;

export function getRemoveHouseholdMemberMutationOptions(
  queryClient: HouseholdCache,
  apiClient: HouseholdMemberDeleteClient = api,
): UseMutationOptions<void, HouseholdApiError, number> {
  return {
    mutationFn: (appuserKey) => removeHouseholdMember(appuserKey, apiClient),
    scope: { id: "household" },
    onSuccess: () => queryClient.invalidateQueries(),
  };
}

export default function useRemoveHouseholdMember() {
  const queryClient = useQueryClient();
  return useMutation(getRemoveHouseholdMemberMutationOptions(queryClient));
}

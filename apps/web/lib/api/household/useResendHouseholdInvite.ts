import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type {
  CreateHouseholdInviteResponse,
  HouseholdApiError,
} from "./types";

export interface HouseholdResendClient {
  post: <T>(url: string) => Promise<{ data: T }>;
}

export async function resendHouseholdInvite(
  householdInviteKey: number,
  apiClient: HouseholdResendClient = api,
): Promise<CreateHouseholdInviteResponse> {
  const { data } = await apiClient.post<CreateHouseholdInviteResponse>(
    `/v1/household/invites/${householdInviteKey}/resend`,
  );
  return data;
}

type HouseholdCache = Pick<QueryClient, "invalidateQueries">;

export function getResendHouseholdInviteMutationOptions(
  queryClient: HouseholdCache,
  apiClient: HouseholdResendClient = api,
): UseMutationOptions<CreateHouseholdInviteResponse, HouseholdApiError, number> {
  return {
    mutationFn: (householdInviteKey) =>
      resendHouseholdInvite(householdInviteKey, apiClient),
    scope: { id: "household" },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: householdQueryKeys.all }),
  };
}

export default function useResendHouseholdInvite() {
  const queryClient = useQueryClient();
  return useMutation(getResendHouseholdInviteMutationOptions(queryClient));
}

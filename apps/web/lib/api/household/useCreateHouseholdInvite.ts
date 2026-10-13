import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type {
  CreateHouseholdInviteInput,
  CreateHouseholdInviteResponse,
  HouseholdApiError,
} from "./types";

export interface HouseholdInvitePostClient {
  post: <T>(
    url: string,
    input: CreateHouseholdInviteInput,
  ) => Promise<{ data: T }>;
}

export async function createHouseholdInvite(
  input: CreateHouseholdInviteInput,
  apiClient: HouseholdInvitePostClient = api,
): Promise<CreateHouseholdInviteResponse> {
  const { data } = await apiClient.post<CreateHouseholdInviteResponse>(
    "/v1/household/invites",
    input,
  );
  return data;
}

type HouseholdCache = Pick<QueryClient, "invalidateQueries">;

export function getCreateHouseholdInviteMutationOptions(
  queryClient: HouseholdCache,
  apiClient: HouseholdInvitePostClient = api,
): UseMutationOptions<
  CreateHouseholdInviteResponse,
  HouseholdApiError,
  CreateHouseholdInviteInput
> {
  return {
    mutationFn: (input) => createHouseholdInvite(input, apiClient),
    scope: { id: "household" },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: householdQueryKeys.all }),
  };
}

export default function useCreateHouseholdInvite() {
  const queryClient = useQueryClient();
  return useMutation(getCreateHouseholdInviteMutationOptions(queryClient));
}

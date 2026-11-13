import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type {
  HouseholdApiError,
  UpdateHouseholdMemberRoleInput,
  UpdateHouseholdMemberRoleResponse,
} from "./types";

export interface HouseholdMemberPatchClient {
  patch: <T>(url: string, body: unknown) => Promise<{ data: T }>;
}

export async function updateHouseholdMemberRole(
  { appuserKey, role }: UpdateHouseholdMemberRoleInput,
  apiClient: HouseholdMemberPatchClient = api,
): Promise<UpdateHouseholdMemberRoleResponse> {
  const { data } = await apiClient.patch<UpdateHouseholdMemberRoleResponse>(
    `/v1/household/members/${appuserKey}`,
    { role },
  );
  return data;
}

type HouseholdCache = Pick<QueryClient, "invalidateQueries">;

export function getUpdateHouseholdMemberRoleMutationOptions(
  queryClient: HouseholdCache,
  apiClient: HouseholdMemberPatchClient = api,
): UseMutationOptions<
  UpdateHouseholdMemberRoleResponse,
  HouseholdApiError,
  UpdateHouseholdMemberRoleInput
> {
  return {
    mutationFn: (input) => updateHouseholdMemberRole(input, apiClient),
    scope: { id: "household" },
    // Someone else's role changed; what the caller sees and can do is the same.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: householdQueryKeys.all }),
  };
}

export default function useUpdateHouseholdMemberRole() {
  const queryClient = useQueryClient();
  return useMutation(getUpdateHouseholdMemberRoleMutationOptions(queryClient));
}

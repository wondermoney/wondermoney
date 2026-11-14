import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { userPreferencesQueryKeys } from "./queryKeys";
import type { UpdateUserPreferencesInput, UserPreferences } from "./types";

export interface UserPreferencesPatchClient {
  patch: <T>(
    url: string,
    input: UpdateUserPreferencesInput,
  ) => Promise<{ data: T }>;
}

export async function updateUserPreferences(
  input: UpdateUserPreferencesInput,
  apiClient: UserPreferencesPatchClient = api,
): Promise<UserPreferences> {
  const { data } = await apiClient.patch<UserPreferences>(
    "/v1/user/me/preferences",
    input,
  );
  return data;
}

export default function useUpdateUserPreferences() {
  const queryClient = useQueryClient();

  return useMutation(getUpdateUserPreferencesMutationOptions(queryClient));
}

type UserPreferencesCache = Pick<QueryClient, "invalidateQueries" | "setQueryData">;

export function getUpdateUserPreferencesMutationOptions(
  queryClient: UserPreferencesCache,
  apiClient: UserPreferencesPatchClient = api,
): UseMutationOptions<
  UserPreferences,
  Error,
  UpdateUserPreferencesInput
> {
  return {
    mutationFn: (input) => updateUserPreferences(input, apiClient),
    scope: { id: "user-preferences" },
    onSuccess: (preferences) => {
      queryClient.setQueryData(userPreferencesQueryKeys.all, preferences);
    },
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: userPreferencesQueryKeys.all,
        exact: true,
        refetchType: "active",
      }),
  };
}

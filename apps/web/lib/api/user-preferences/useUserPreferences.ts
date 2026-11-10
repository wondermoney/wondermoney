import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";
import { userPreferencesQueryKeys } from "./queryKeys";
import type { UserPreferences } from "./types";

export interface UserPreferencesGetClient {
  get: <T>(url: string) => Promise<{ data: T }>;
}

export async function getUserPreferences(
  apiClient: UserPreferencesGetClient = api,
): Promise<UserPreferences> {
  const { data } = await apiClient.get<UserPreferences>(
    "/v1/user/me/preferences",
  );
  return data;
}

export default function useUserPreferences<R = UserPreferences>(
  options?: Omit<
    UseQueryOptions<UserPreferences, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: userPreferencesQueryKeys.all,
    queryFn: () => getUserPreferences(),
    ...options,
  });
}

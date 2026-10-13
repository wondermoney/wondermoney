import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type { HouseholdApiError, HouseholdResponse } from "./types";

export interface HouseholdGetClient {
  get: <T>(url: string) => Promise<{ data: T }>;
}

export async function getHousehold(
  apiClient: HouseholdGetClient = api,
): Promise<HouseholdResponse> {
  const { data } = await apiClient.get<HouseholdResponse>("/v1/household");
  return data;
}

export default function useHousehold<R = HouseholdResponse>(
  options?: Omit<
    UseQueryOptions<HouseholdResponse, HouseholdApiError, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: householdQueryKeys.all,
    queryFn: () => getHousehold(),
    ...options,
  });
}

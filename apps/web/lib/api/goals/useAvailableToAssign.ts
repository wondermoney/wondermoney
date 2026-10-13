import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { availableToAssignQueryKey } from "./keys";
import type { GetAvailableToAssignResponse } from "./types";

export async function getAvailableToAssign(
  apiClient: AxiosInstance = api,
): Promise<GetAvailableToAssignResponse> {
  const { data } = await apiClient.get<GetAvailableToAssignResponse>(
    "/v1/goals/available-to-assign",
  );
  return data;
}

export default function useAvailableToAssign<R = GetAvailableToAssignResponse>(
  options?: Omit<UseQueryOptions<GetAvailableToAssignResponse, Error, R>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: availableToAssignQueryKey,
    queryFn: () => getAvailableToAssign(),
    ...options,
  });
}

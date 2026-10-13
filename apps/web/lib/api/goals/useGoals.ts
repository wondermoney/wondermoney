import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { goalsQueryKey } from "./keys";
import type { GetGoalsParams, GetGoalsResponse } from "./types";

export async function getGoals(
  params: GetGoalsParams = {},
  apiClient: AxiosInstance = api,
): Promise<GetGoalsResponse> {
  const { data } = await apiClient.get<GetGoalsResponse>("/v1/goals", {
    params,
  });
  return data;
}

export default function useGoals<R = GetGoalsResponse>(
  params?: GetGoalsParams,
  options?: Omit<
    UseQueryOptions<GetGoalsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: [...goalsQueryKey, params ?? {}],
    queryFn: () => getGoals(params),
    ...options,
  });
}

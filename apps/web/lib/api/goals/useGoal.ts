import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { goalQueryKey } from "./keys";
import type { GetGoalResponse } from "./types";

export async function getGoal(goalKey: number, apiClient: AxiosInstance = api): Promise<GetGoalResponse> {
  const { data } = await apiClient.get<GetGoalResponse>(`/v1/goals/${goalKey}`);
  return data;
}

export default function useGoal<R = GetGoalResponse>(
  goalKey: number,
  options?: Omit<UseQueryOptions<GetGoalResponse, Error, R>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: goalQueryKey(goalKey),
    queryFn: () => getGoal(goalKey),
    ...options,
  });
}

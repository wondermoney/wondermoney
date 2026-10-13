import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { debtStrategyQueryKey } from "./keys";
import type { DebtStrategyResponse } from "./types";

export async function getDebtStrategy(
  apiClient: AxiosInstance = api,
): Promise<DebtStrategyResponse> {
  const { data } = await apiClient.get<DebtStrategyResponse>(
    "/v1/goals/debt-strategy",
  );
  return data;
}

export default function useDebtStrategy<R = DebtStrategyResponse>(
  options?: Omit<
    UseQueryOptions<DebtStrategyResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: debtStrategyQueryKey,
    queryFn: () => getDebtStrategy(),
    ...options,
  });
}

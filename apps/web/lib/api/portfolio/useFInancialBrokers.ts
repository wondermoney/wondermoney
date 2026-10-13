import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface FinancialBroker {
  financialBrokerKey: string;
  name: string;
  displayName: string;
}

export interface GetFinancialBrokersResponse {
  brokers: FinancialBroker[];
}

export async function getFinancialBrokers(
  apiClient: AxiosInstance = api,
): Promise<GetFinancialBrokersResponse> {
  const { data } = await apiClient.get<GetFinancialBrokersResponse>(
    `/v1/portfolio/brokers`,
  );
  return data;
}

export default function useFinancialBrokers<R = GetFinancialBrokersResponse>(
  options?: Omit<
    UseQueryOptions<GetFinancialBrokersResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["financial-brokers"],
    queryFn: () => getFinancialBrokers(),
    ...options,
  });
}

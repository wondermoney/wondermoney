import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface FinancialInstitution {
  accountFinancialInstitutionKey: number;
  displayName: string;
  logoUrl?: string;
}

export interface GetFinancialInstitutionsResponse {
  accountFinancialInstitutions: FinancialInstitution[];
}

export async function getFinancialInstitutions(
  apiClient: AxiosInstance = api,
): Promise<GetFinancialInstitutionsResponse> {
  const { data } = await apiClient.get<GetFinancialInstitutionsResponse>(
    "/v1/account/financial-institutions",
  );
  return data;
}

export default function useFinancialInstitutions<
  R = GetFinancialInstitutionsResponse,
>(
  options?: Omit<
    UseQueryOptions<GetFinancialInstitutionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["financial-institutions"],
    queryFn: () => getFinancialInstitutions(),
    ...options,
  });
}

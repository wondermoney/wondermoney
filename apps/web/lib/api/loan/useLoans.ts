import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { LoanListItem } from "./types";

export interface GetLoansResponse {
  loans: LoanListItem[];
}

async function getLoans(
  apiClient: AxiosInstance = api,
): Promise<GetLoansResponse> {
  const { data } = await apiClient.get<GetLoansResponse>("/v1/loan");
  return data;
}

export default function useLoans<R = GetLoansResponse>(
  options?: Omit<
    UseQueryOptions<GetLoansResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loans"],
    queryFn: () => getLoans(),
    ...options,
  });
}

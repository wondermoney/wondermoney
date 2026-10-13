import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { sortBanksForCountry } from "./sort-banks";

export interface Bank {
  id: string;
  name: string;
  country: string;
  logo: string | null;
}

export type GetBankListResponse = Array<Bank>;

export async function getBankList(
  country: string,
  apiClient: AxiosInstance = api,
): Promise<GetBankListResponse> {
  const { data } = await apiClient.get<GetBankListResponse>("/v1/banking/bank", {
    params: { country },
  });
  // Sorted here rather than in each consumer so the picker and the onboarding
  // step can't drift apart — both render whatever this returns. See sort-banks.ts
  // for why provider order is the wrong order.
  return sortBanksForCountry(data, country);
}

export default function useBankList<R = GetBankListResponse>(
  country: string,
  options?: Omit<
    UseQueryOptions<GetBankListResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["bankList", country],
    queryFn: () => getBankList(country),
    ...options,
  });
}

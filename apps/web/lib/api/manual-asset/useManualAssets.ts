import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { GetManualAssetsResponse } from "./types";

export async function getManualAssets(
  apiClient: AxiosInstance = api,
): Promise<GetManualAssetsResponse> {
  const { data } =
    await apiClient.get<GetManualAssetsResponse>("/v1/manual-assets");
  return data;
}

export default function useManualAssets<R = GetManualAssetsResponse>(
  options?: Omit<
    UseQueryOptions<GetManualAssetsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["manual-assets"],
    queryFn: () => getManualAssets(),
    ...options,
  });
}

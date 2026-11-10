import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { GetManualAssetResponse } from "./types";

export async function getManualAsset(
  manualAssetId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetManualAssetResponse> {
  const { data } = await apiClient.get<GetManualAssetResponse>(
    `/v1/manual-assets/${manualAssetId}`,
  );
  return data;
}

export default function useManualAsset<R = GetManualAssetResponse>(
  manualAssetId: number | string,
  options?: Omit<
    UseQueryOptions<GetManualAssetResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["manual-asset", String(manualAssetId)],
    queryFn: () => getManualAsset(manualAssetId),
    ...options,
  });
}

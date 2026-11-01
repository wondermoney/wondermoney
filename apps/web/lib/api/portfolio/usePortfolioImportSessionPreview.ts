import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";
import type { PortfolioImportSessionPreviewResponse } from "./importSessionTypes";

export const buildPortfolioImportSessionPreviewUrl = (
  importSessionId: string | number,
  limit = 25,
) => `/v1/portfolio-import-sessions/${importSessionId}?limit=${limit}`;

export const portfolioImportSessionPreviewQueryKey = (
  importSessionId: string | number,
  limit = 25,
) => ["portfolio-import-session-preview", importSessionId, limit] as const;

async function getPortfolioImportSessionPreview(
  importSessionId: string | number,
  limit = 25,
) {
  const { data } = await api.get<PortfolioImportSessionPreviewResponse>(
    buildPortfolioImportSessionPreviewUrl(importSessionId, limit),
  );
  return data;
}

export default function usePortfolioImportSessionPreview<R = PortfolioImportSessionPreviewResponse>(
  importSessionId: string | number,
  limit = 25,
  options?: Omit<UseQueryOptions<PortfolioImportSessionPreviewResponse, Error, R>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: portfolioImportSessionPreviewQueryKey(importSessionId, limit),
    queryFn: () => getPortfolioImportSessionPreview(importSessionId, limit),
    ...options,
  });
}

import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportSessionSuggestColumnMappingRequest,
  PortfolioImportSessionSuggestColumnMappingResponse,
} from "./importSessionTypes";

export const buildSuggestPortfolioImportColumnMappingUrl = (importSessionId: string | number) =>
  `/v1/portfolio-import-sessions/${importSessionId}/column-mapping/suggest`;

export const buildSuggestPortfolioImportColumnMappingPayload = () => ({});

export default function useSuggestPortfolioImportColumnMapping() {
  return useMutation({
    mutationFn: ({ importSessionId }: PortfolioImportSessionSuggestColumnMappingRequest) =>
      api.post<PortfolioImportSessionSuggestColumnMappingResponse>(
        buildSuggestPortfolioImportColumnMappingUrl(importSessionId),
        buildSuggestPortfolioImportColumnMappingPayload(),
      ),
  });
}

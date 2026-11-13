import { useMutation } from "@tanstack/react-query";

import api from "../api";
import { API_ERROR_CODE, getApiErrorCode } from "../errors";
import type {
  PortfolioImportSessionSuggestColumnMappingRequest,
  PortfolioImportSessionSuggestColumnMappingResponse,
} from "./importSessionTypes";

export const buildSuggestPortfolioImportColumnMappingUrl = (importSessionId: string | number) =>
  `/v1/portfolio-import-sessions/${importSessionId}/column-mapping/suggest`;

export const buildSuggestPortfolioImportColumnMappingPayload = () => ({});

/**
 * Whether an older API refused the suggestion because AI is off: it gated the whole route on AI
 * (501 with no provider, 403 `feature_disabled` for a person who hid AI). That leaves the
 * columns to the person, as an answer with no suggestion does, rather than an error to retry.
 * The current API answers without AI, from a saved mapping or the column names.
 */
export function isSuggestionRefusedWithoutAi(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | undefined)?.response?.status;
  if (status === 501) return true;
  return status === 403 && getApiErrorCode(error) === API_ERROR_CODE.FEATURE_DISABLED;
}

export default function useSuggestPortfolioImportColumnMapping() {
  return useMutation({
    mutationFn: ({ importSessionId }: PortfolioImportSessionSuggestColumnMappingRequest) =>
      api.post<PortfolioImportSessionSuggestColumnMappingResponse>(
        buildSuggestPortfolioImportColumnMappingUrl(importSessionId),
        buildSuggestPortfolioImportColumnMappingPayload(),
      ),
  });
}

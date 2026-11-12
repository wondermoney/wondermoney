import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportSessionRowInclusionRequest,
  PortfolioImportSessionRowInclusionResponse,
} from "./importSessionTypes";

export const buildUpdatePortfolioImportRowInclusionUrl = (
  importSessionId: string | number,
) => `/v1/portfolio-import-sessions/${importSessionId}/row-inclusions`;

/**
 * Positions files: include a row whose asset already has trades in the portfolio (it becomes an
 * opening buy anyway), or skip it again.
 */
export default function useUpdatePortfolioImportRowInclusion() {
  return useMutation({
    mutationFn: ({ importSessionId, rows }: PortfolioImportSessionRowInclusionRequest) =>
      api.patch<PortfolioImportSessionRowInclusionResponse>(
        buildUpdatePortfolioImportRowInclusionUrl(importSessionId),
        { rows },
      ),
  });
}

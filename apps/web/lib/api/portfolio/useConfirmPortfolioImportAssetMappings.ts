import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportAssetMappingDecision,
  PortfolioImportSessionConfirmAssetMappingsRequest,
  PortfolioImportSessionConfirmAssetMappingsResponse,
} from "./importSessionTypes";

export const buildConfirmPortfolioImportAssetMappingsUrl = (importSessionId: string | number) =>
  `/v1/portfolio-import-sessions/${importSessionId}/asset-mappings`;

export const buildConfirmPortfolioImportAssetMappingsPayload = (
  decisions: PortfolioImportAssetMappingDecision[],
) => ({
  decisions,
});

export default function useConfirmPortfolioImportAssetMappings() {
  return useMutation({
    mutationFn: ({
      importSessionId,
      decisions,
    }: PortfolioImportSessionConfirmAssetMappingsRequest) =>
      api.patch<PortfolioImportSessionConfirmAssetMappingsResponse>(
        buildConfirmPortfolioImportAssetMappingsUrl(importSessionId),
        buildConfirmPortfolioImportAssetMappingsPayload(decisions),
      ),
  });
}

import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportColumnMappingDerivedValues,
  PortfolioImportColumnMappingFixedValues,
  PortfolioImportSessionConfirmColumnMappingRequest,
  PortfolioImportSessionConfirmColumnMappingResponse,
} from "./importSessionTypes";

export const buildConfirmPortfolioImportColumnMappingUrl = (importSessionId: string | number) =>
  `/v1/portfolio-import-sessions/${importSessionId}/column-mapping`;

export const buildConfirmPortfolioImportColumnMappingPayload = (
  columnMapping: PortfolioImportSessionConfirmColumnMappingRequest["columnMapping"],
  fixedValues: PortfolioImportColumnMappingFixedValues = {},
  derivedValues: PortfolioImportColumnMappingDerivedValues = {},
  layout: PortfolioImportSessionConfirmColumnMappingRequest["layout"] = {
    headerRowIndex: 0,
    dataStartRowIndex: 1,
  },
  transformations: PortfolioImportSessionConfirmColumnMappingRequest["transformations"] = {},
) => ({
  columnMapping,
  fixedValues,
  derivedValues,
  layout,
  transformations,
});

export default function useConfirmPortfolioImportColumnMapping() {
  return useMutation({
    mutationFn: ({
      importSessionId,
      columnMapping,
      fixedValues,
      derivedValues,
      layout,
      transformations,
    }: PortfolioImportSessionConfirmColumnMappingRequest) =>
      api.patch<PortfolioImportSessionConfirmColumnMappingResponse>(
        buildConfirmPortfolioImportColumnMappingUrl(importSessionId),
        buildConfirmPortfolioImportColumnMappingPayload(
          columnMapping,
          fixedValues,
          derivedValues,
          layout,
          transformations,
        ),
      ),
  });
}

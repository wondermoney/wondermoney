import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportSessionCreateRequest,
  PortfolioImportSessionCreateResponse,
} from "./importSessionTypes";

export const buildCreatePortfolioImportSessionUrl = (portfolioId: string | number) =>
  `/v1/portfolio/${portfolioId}/import-sessions`;

export const buildCreatePortfolioImportSessionPayload = (
  input: Pick<PortfolioImportSessionCreateRequest, "brokerId" | "importType"> = {},
) => ({
  mode: "review" as const,
  ...(input.brokerId !== undefined ? { brokerId: input.brokerId } : {}),
  // Trades is the API's default; only a positions file says what it is.
  ...(input.importType === "positions" ? { importType: input.importType } : {}),
});

export default function useCreatePortfolioImportSession() {
  return useMutation({
    mutationFn: ({ portfolioId, brokerId, importType }: PortfolioImportSessionCreateRequest) =>
      api.post<PortfolioImportSessionCreateResponse>(
        buildCreatePortfolioImportSessionUrl(portfolioId),
        buildCreatePortfolioImportSessionPayload({ brokerId, importType }),
      ),
  });
}

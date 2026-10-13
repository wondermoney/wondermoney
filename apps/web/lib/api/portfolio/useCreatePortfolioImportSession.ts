import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportSessionCreateRequest,
  PortfolioImportSessionCreateResponse,
} from "./importSessionTypes";

export const buildCreatePortfolioImportSessionUrl = (portfolioId: string | number) =>
  `/v1/portfolio/${portfolioId}/import-sessions`;

export const buildCreatePortfolioImportSessionPayload = (
  input: Pick<PortfolioImportSessionCreateRequest, "brokerId"> = {},
) => ({
  mode: "review" as const,
  ...(input.brokerId !== undefined ? { brokerId: input.brokerId } : {}),
});

export default function useCreatePortfolioImportSession() {
  return useMutation({
    mutationFn: ({ portfolioId, brokerId }: PortfolioImportSessionCreateRequest) =>
      api.post<PortfolioImportSessionCreateResponse>(
        buildCreatePortfolioImportSessionUrl(portfolioId),
        buildCreatePortfolioImportSessionPayload({ brokerId }),
      ),
  });
}

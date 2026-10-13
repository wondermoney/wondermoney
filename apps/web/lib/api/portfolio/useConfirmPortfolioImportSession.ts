import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportSessionConfirmRequest,
  PortfolioImportSessionConfirmResponse,
} from "./importSessionTypes";

export const buildConfirmPortfolioImportSessionUrl = (importSessionId: string | number) =>
  `/v1/portfolio-import-sessions/${importSessionId}/confirm`;

export default function useConfirmPortfolioImportSession() {
  return useMutation({
    mutationFn: ({ importSessionId }: PortfolioImportSessionConfirmRequest) =>
      api.post<PortfolioImportSessionConfirmResponse>(
        buildConfirmPortfolioImportSessionUrl(importSessionId),
      ),
  });
}

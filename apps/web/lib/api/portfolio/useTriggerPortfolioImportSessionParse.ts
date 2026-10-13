import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type {
  PortfolioImportSessionParseRequest,
  PortfolioImportSessionParseResponse,
} from "./importSessionTypes";

export const buildTriggerPortfolioImportSessionParseUrl = (importSessionId: string | number) =>
  `/v1/portfolio-import-sessions/${importSessionId}/parse`;

export default function useTriggerPortfolioImportSessionParse() {
  return useMutation({
    mutationFn: ({ importSessionId }: PortfolioImportSessionParseRequest) =>
      api.post<PortfolioImportSessionParseResponse>(
        buildTriggerPortfolioImportSessionParseUrl(importSessionId),
      ),
  });
}

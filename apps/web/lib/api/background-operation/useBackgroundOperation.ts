import { useQuery } from "@tanstack/react-query";

import api from "../api";
import { getBackgroundOperationRefetchInterval } from "./backgroundOperation";

export interface BackgroundOperationResponse {
  correlationId: string;
  progress?: Record<string, unknown> | null;
  status: string;
}

export function useBackgroundOperation(correlationId?: string) {
  return useQuery({
    enabled: !!correlationId,
    queryKey: ["background-operation", correlationId],
    queryFn: () =>
      api
        .get<BackgroundOperationResponse>(`/v1/operations/${correlationId}`)
        .then((res) => res.data),
    refetchInterval: (query) =>
      getBackgroundOperationRefetchInterval(
        query.state.data?.status,
        query.state.data?.progress,
      ),
  });
}

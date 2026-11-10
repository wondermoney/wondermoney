import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";

/**
 * `GET /v1/banking/connections/:connectionId/syncs` (apps/api
 * `controller/banking-connections.ts`). One entry per attempt, newest first,
 * at most 20. `result` and `errorCode` are null while a run is still going.
 */
export interface BankSyncHistoryRun {
  accounts: number | null;
  errorCode: string | null;
  finishedAt: string | null;
  flow: "initial-add" | "scheduled-refresh" | null;
  result: "failed" | "full_success" | "partial" | null;
  /** When the next attempt is due, for a rate-limited run. */
  retryAt: string | null;
  rowsCreated: number | null;
  startedAt: string;
}

export interface BankSyncHistoryResponse {
  syncs: BankSyncHistoryRun[];
}

export async function getBankSyncHistory(
  connectionId: number,
  apiClient: Pick<AxiosInstance, "get"> = api,
): Promise<BankSyncHistoryResponse> {
  const { data } = await apiClient.get<BankSyncHistoryResponse>(
    `/v1/banking/connections/${connectionId}/syncs`,
  );
  return data;
}

export default function useBankSyncHistory(
  connectionId: number | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["banking", "connections", connectionId, "syncs"],
    queryFn: () => getBankSyncHistory(connectionId as number),
    enabled: (options?.enabled ?? true) && connectionId !== null,
  });
}

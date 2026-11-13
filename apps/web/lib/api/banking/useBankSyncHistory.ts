import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";

/**
 * `GET /v1/banking/connections/:connectionId/syncs` (apps/api
 * `controller/banking-connections.ts`), or for a SimpleFIN connection
 * `GET /v1/banking/simplefin/connections/:connectionId/syncs`: the two providers
 * number their connections separately. One entry per attempt, newest first,
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

/** The providers whose connections have a sync history. */
export type BankSyncHistoryProvider = "EnableBanking" | "SimpleFIN";

export function bankSyncHistoryUrl(
  connectionId: number,
  provider: BankSyncHistoryProvider = "EnableBanking",
): string {
  return provider === "SimpleFIN"
    ? `/v1/banking/simplefin/connections/${connectionId}/syncs`
    : `/v1/banking/connections/${connectionId}/syncs`;
}

export async function getBankSyncHistory(
  connectionId: number,
  apiClient: Pick<AxiosInstance, "get"> = api,
  provider: BankSyncHistoryProvider = "EnableBanking",
): Promise<BankSyncHistoryResponse> {
  const { data } = await apiClient.get<BankSyncHistoryResponse>(
    bankSyncHistoryUrl(connectionId, provider),
  );
  return data;
}

export default function useBankSyncHistory(
  connectionId: number | null,
  options?: { enabled?: boolean; provider?: BankSyncHistoryProvider },
) {
  const provider = options?.provider ?? "EnableBanking";
  return useQuery({
    queryKey:
      provider === "SimpleFIN"
        ? ["banking", "simplefin", "connections", connectionId, "syncs"]
        : ["banking", "connections", connectionId, "syncs"],
    queryFn: () => getBankSyncHistory(connectionId as number, api, provider),
    enabled: (options?.enabled ?? true) && connectionId !== null,
  });
}

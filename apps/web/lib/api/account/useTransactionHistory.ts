import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export type TransactionAuditEventType =
  | "balance_recalc"
  | "categorized"
  | "created"
  | "dedup_skipped"
  | "pending_expired"
  | "pending_promoted"
  | "soft_deleted"
  | "system_edit"
  | "user_edit";

export type TransactionAuditActorType = "ai" | "sync" | "system" | "user";

export interface TransactionHistoryEntry {
  transactionAuditLogKey: number;
  eventType: TransactionAuditEventType;
  actorType: TransactionAuditActorType;
  source: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export interface GetTransactionHistoryResponse {
  history: TransactionHistoryEntry[];
}

export async function getTransactionHistory(
  transactionId: number,
  apiClient: AxiosInstance = api,
): Promise<GetTransactionHistoryResponse> {
  const { data } = await apiClient.get<GetTransactionHistoryResponse>(
    `/v1/account/transaction/${transactionId}/history`,
  );
  return { history: Array.isArray(data?.history) ? data.history : [] };
}

/**
 * Per-transaction activity log (RAD-346). Answers "who changed what, when" — created,
 * recategorized, amount edited, promoted from pending, expired.
 */
export default function useTransactionHistory(
  transactionId: number | null | undefined,
  options?: Omit<
    UseQueryOptions<GetTransactionHistoryResponse, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["transaction-history", transactionId],
    queryFn: () => getTransactionHistory(transactionId as number),
    enabled: transactionId != null,
    ...options,
  });
}

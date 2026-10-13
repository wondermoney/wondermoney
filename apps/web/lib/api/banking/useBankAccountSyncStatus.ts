import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import {
  getLegacyBankSyncStatus,
  type LegacyBankSyncStatus,
} from "@/lib/account/legacy-bank-sync-status";
import api from "@/lib/api/api";
import useRequisition from "@/lib/api/user/useRequisition";

export type BankSyncIncidentState =
  | "processing"
  | "succeeded"
  | "partial"
  | "failed";
export type BankSyncIncidentResult =
  | "pending"
  | "full_success"
  | "partial"
  | "failed";

export interface BankSyncIncidentStatus {
  incidentId: string;
  state: BankSyncIncidentState;
  result: BankSyncIncidentResult;
  final: boolean;
  retryable: boolean;
  attempts: number;
  errorCategory?: string;
  errorCode?: string;
}

export const BANK_SYNC_INCIDENT_POLL_INTERVAL_MS = 2500;

export type { LegacyBankSyncStatus };

export const bankSyncIncidentStatusQueryKey = (incidentId?: string | null) =>
  ["banking", "sync-incident", incidentId] as const;

export async function getBankAccountSyncStatus(
  incidentId: string,
  apiClient: AxiosInstance = api,
): Promise<BankSyncIncidentStatus> {
  const { data } = await apiClient.get<BankSyncIncidentStatus>(
    `/v1/banking/sync/${incidentId}/status`,
  );
  return data;
}

type BankSyncStatusOptions = Omit<
  UseQueryOptions<BankSyncIncidentStatus, Error>,
  "queryKey" | "queryFn" | "refetchInterval" | "enabled"
> & { enabled?: boolean };

export default function useBankAccountSyncStatus(
  incidentId?: string | null,
  options?: BankSyncStatusOptions,
) {
  return useQuery({
    queryKey: bankSyncIncidentStatusQueryKey(incidentId),
    queryFn: () => getBankAccountSyncStatus(incidentId!),
    enabled: Boolean(incidentId) && (options?.enabled ?? true),
    retry: 2,
    refetchInterval: ({ state: queryState }) => {
      const data = queryState.data;
      if (data?.final) return false;
      return !data || data.state === "processing" || data.retryable
        ? BANK_SYNC_INCIDENT_POLL_INTERVAL_MS
        : false;
    },
    ...options,
  });
}

/**
 * Temporary web-first rollout fallback. New callbacks use the opaque sync UUID;
 * legacy API callbacks may still return nrid until the API deployment catches up.
 */
export function useLegacyBankAccountSyncStatus(
  userId?: string,
  legacyRequisitionId?: string | null,
) {
  const enabled = Boolean(userId && legacyRequisitionId);
  const query = useRequisition(userId, legacyRequisitionId, {
    enabled,
    retry: 2,
    refetchInterval: ({ state }) => {
      const status = getLegacyBankSyncStatus({
        enabled,
        isError: state.status === "error",
        isFetched: state.dataUpdatedAt > 0,
        data: state.data,
      });
      return status === "processing"
        ? BANK_SYNC_INCIDENT_POLL_INTERVAL_MS
        : false;
    },
  });

  return {
    ...query,
    legacyStatus: getLegacyBankSyncStatus({
      enabled,
      isError: query.isError || query.isRefetchError,
      isFetched: query.isFetched,
      data: query.data,
    }),
  };
}

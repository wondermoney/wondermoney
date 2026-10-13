import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { useRef } from "react";

import api from "../api";

export type PortfolioHistoryStatus =
  | "partial"
  | "processing"
  | "ready";

export type LegacyPortfolioHistoryStatus = PortfolioHistoryStatus | "unavailable";

export interface PortfolioReadinessMetadata {
  note?: string | null;
  status: PortfolioHistoryStatus;
}

export interface PortfolioHistoryStatusResponse {
  assetsTotal: number;
  assetsReady: number;
  assetsPending: number;
  earliestRequiredDate: string | null;
  earliestSnapshotDate: string | null;
  latestSnapshotDate: string | null;
  readiness?: PortfolioReadinessMetadata;
  status: LegacyPortfolioHistoryStatus;
}

const PORTFOLIO_HISTORY_STATUS_INITIAL_POLL_INTERVAL_MS = 2000;
const PORTFOLIO_HISTORY_STATUS_MAX_POLL_INTERVAL_MS = 30000;

function getPortfolioHistoryStatusFingerprint(
  status?: PortfolioHistoryStatusResponse | null,
) {
  if (!status) return undefined;

  return [
    normalizePortfolioHistoryStatus(status.status) ?? "unknown",
    status.assetsPending,
    status.assetsReady,
    status.assetsTotal,
    status.earliestRequiredDate ?? "",
    status.earliestSnapshotDate ?? "",
    status.latestSnapshotDate ?? "",
    status.readiness?.status ?? "",
    status.readiness?.note ?? "",
  ].join("|");
}

export function getPortfolioHistoryStatusRefetchInterval(
  status?: PortfolioHistoryStatusResponse | null,
  previousFingerprint?: string,
  previousIntervalMs?: number,
) {
  if (!status) return false;

  const normalizedStatus = normalizePortfolioHistoryStatus(status.status);
  if (normalizedStatus === "ready" || normalizedStatus === "unavailable") {
    return false;
  }

  const currentFingerprint = getPortfolioHistoryStatusFingerprint(status);
  const isProgressing = currentFingerprint !== previousFingerprint;

  if (isProgressing || !previousIntervalMs) {
    return PORTFOLIO_HISTORY_STATUS_INITIAL_POLL_INTERVAL_MS;
  }

  return Math.min(
    previousIntervalMs * 2,
    PORTFOLIO_HISTORY_STATUS_MAX_POLL_INTERVAL_MS,
  );
}

export function getPortfolioHistoryStatusPollingState(
  status?: PortfolioHistoryStatusResponse | null,
  previousFingerprint?: string,
  previousIntervalMs?: number,
) {
  const interval = getPortfolioHistoryStatusRefetchInterval(
    status,
    previousFingerprint,
    previousIntervalMs,
  );

  return {
    interval,
    fingerprint: getPortfolioHistoryStatusFingerprint(status),
    intervalMs: typeof interval === "number" ? interval : undefined,
  };
}

export function getPortfolioHistoryStatusPollInterval(
  state: {
    dataUpdatedAt?: number;
    fingerprint?: string;
    intervalMs?: number;
  },
  dataUpdatedAt: number,
  status?: PortfolioHistoryStatusResponse | null,
) {
  if (state.dataUpdatedAt === dataUpdatedAt) {
    return {
      ...state,
      interval: state.intervalMs ?? false,
    };
  }

  const nextState = getPortfolioHistoryStatusPollingState(
    status,
    state.fingerprint,
    state.intervalMs,
  );

  return {
    dataUpdatedAt,
    ...nextState,
  };
}

export async function getPortfolioHistoryStatus(
  portfolioId: number,
  apiClient: AxiosInstance = api,
): Promise<PortfolioHistoryStatusResponse> {
  const { data } = await apiClient.get<PortfolioHistoryStatusResponse>(
    `/v1/portfolio/${portfolioId}/history-status`,
  );
  return data;
}

export function normalizePortfolioHistoryStatus(
  status?: LegacyPortfolioHistoryStatus | null,
): LegacyPortfolioHistoryStatus | undefined {
  if (
    status === "ready" ||
    status === "processing" ||
    status === "partial" ||
    status === "unavailable"
  ) {
    return status;
  }

  return undefined;
}

export default function usePortfolioHistoryStatus<R = PortfolioHistoryStatusResponse>(
  portfolioId: number | null = null,
  options?: Omit<
    UseQueryOptions<PortfolioHistoryStatusResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  const pollingStateRef = useRef<{
    dataUpdatedAt?: number;
    fingerprint?: string;
    intervalMs?: number;
  }>({});
  const {
    enabled: optionsEnabled = true,
    refetchInterval,
    ...restOptions
  } = options ?? {};
  const enabled = !!portfolioId && optionsEnabled;
  const effectiveRefetchInterval = refetchInterval ?? ((query) => {
    if (pollingStateRef.current.dataUpdatedAt !== query.state.dataUpdatedAt) {
      pollingStateRef.current = {
        dataUpdatedAt: query.state.dataUpdatedAt,
        ...getPortfolioHistoryStatusPollingState(
          query.state.data,
          pollingStateRef.current.fingerprint,
          pollingStateRef.current.intervalMs,
        ),
      };
    }

    return pollingStateRef.current.intervalMs ?? false;
  });

  return useQuery({
    queryKey: ["portfolio-history-status", portfolioId],
    queryFn: () => {
      if (!portfolioId) {
        throw new Error("portfolioId is required");
      }

      return getPortfolioHistoryStatus(portfolioId);
    },
    ...restOptions,
    enabled,
    refetchInterval: effectiveRefetchInterval,
  });
}

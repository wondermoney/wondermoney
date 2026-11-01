import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";

/**
 * `GET /v1/banking/connections` (apps/api `controller/banking-connections.ts`).
 * `processing` covers both "consent not finished" and "linked, but not every
 * account has been refreshed yet"; `connected` means the first import landed.
 */
export type BankConnectionStatus =
  | "connected"
  | "error"
  | "expired"
  | "processing";

export interface BankConnection {
  accessType: "open_banking";
  dataFreshAsOf: string | null;
  expiresAt: string | null;
  institutionName: string | null;
  provider: "EnableBanking" | "GoCardless";
  status: BankConnectionStatus;
}

export interface BankConnectionsResponse {
  connections: BankConnection[];
}

const BANK_CONNECTIONS_POLL_INTERVAL_MS = 2500;
// About five minutes of polling. An initial import that has not finished by
// then is still running in the background; the page stops asking.
const MAX_POLLS = 120;

export async function getBankConnections(
  apiClient: AxiosInstance = api,
): Promise<BankConnectionsResponse> {
  const { data } = await apiClient.get<BankConnectionsResponse>(
    "/v1/banking/connections",
  );
  return data;
}

/** The API lists Enable Banking connections newest first. */
export function latestEnableBankingConnection(
  connections: BankConnection[] | undefined,
): BankConnection | undefined {
  return connections?.find(
    (connection) => connection.provider === "EnableBanking",
  );
}

/** Polls while the newest Enable Banking connection is still importing. */
export default function useBankConnections(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["banking", "connections"],
    queryFn: () => getBankConnections(),
    enabled: options?.enabled ?? true,
    refetchInterval: ({ state }) =>
      state.dataUpdateCount < MAX_POLLS &&
      latestEnableBankingConnection(state.data?.connections)?.status ===
        "processing"
        ? BANK_CONNECTIONS_POLL_INTERVAL_MS
        : false,
  });
}

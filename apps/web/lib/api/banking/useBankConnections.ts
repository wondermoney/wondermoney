import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";

/**
 * `GET /v1/banking/connections` (apps/api `controller/banking-connections.ts`).
 * `processing` covers both "consent not finished" and "linked, but not every
 * account has been refreshed yet"; `connected` means the first import landed.
 * `expiring`: the consent ends within 14 days. `revoked`: the bank ended it
 * before its end date; for a SimpleFIN connection, SimpleFIN refused the stored access, so it has
 * to be connected again with a new setup token.
 */
export type BankConnectionStatus =
  | "connected"
  | "error"
  | "expired"
  | "expiring"
  | "processing"
  | "revoked";

export type BankConnectionProvider = "EnableBanking" | "GoCardless" | "SimpleFIN";

/** The newest failure for a connection, as an error code `@wondermoney/shared/bank-sync` names. */
export interface BankConnectionLastError {
  code: string;
  occurredAt: string;
}

export interface BankConnection {
  accessType: "open_banking";
  /** The bank id `GET /v1/banking/bank/:bankId/start` takes; null for GoCardless and SimpleFIN. */
  bankId?: string | null;
  /**
   * The id the connection's own routes take. Enable Banking and SimpleFIN are separate id
   * spaces (`provider` tells them apart); null for GoCardless.
   */
  connectionId?: number | null;
  dataFreshAsOf: string | null;
  daysUntilExpiry?: number | null;
  expiresAt: string | null;
  institutionName: string | null;
  lastError?: BankConnectionLastError | null;
  provider: BankConnectionProvider;
  status: BankConnectionStatus;
}

/** A SimpleFIN connection: no consent end date and its own `connectionId`. */
export interface SimplefinBankConnection extends BankConnection {
  connectionId: number;
  provider: "SimpleFIN";
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

/** The SimpleFIN connections, newest first, that have an id their own routes take. */
export function simplefinConnections(
  connections: BankConnection[] | undefined,
): SimplefinBankConnection[] {
  return (connections ?? []).filter(
    (connection): connection is SimplefinBankConnection =>
      connection.provider === "SimpleFIN" &&
      typeof connection.connectionId === "number",
  );
}

function isImporting(connections: BankConnection[] | undefined): boolean {
  return (
    latestEnableBankingConnection(connections)?.status === "processing" ||
    simplefinConnections(connections).some(
      (connection) => connection.status === "processing",
    )
  );
}

/**
 * Polls while the newest Enable Banking connection, or any SimpleFIN connection, is still
 * importing its first sync.
 */
export default function useBankConnections(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["banking", "connections"],
    queryFn: () => getBankConnections(),
    enabled: options?.enabled ?? true,
    refetchInterval: ({ state }) =>
      state.dataUpdateCount < MAX_POLLS && isImporting(state.data?.connections)
        ? BANK_CONNECTIONS_POLL_INTERVAL_MS
        : false,
  });
}

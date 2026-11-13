import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

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

/** An account a connection feeds, as its owner named it. */
export interface BankConnectionAccount {
  accountKey: number;
  accountName: string | null;
}

export interface BankConnection {
  accessType: "open_banking";
  /**
   * SimpleFIN only: the linked accounts the viewer can see (never another member's private
   * account). Absent from other providers' rows and from an older API.
   */
  accounts?: BankConnectionAccount[];
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

export const BANK_CONNECTIONS_QUERY_KEY = ["banking", "connections"] as const;

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

function connectionId(connection: BankConnection): string | null {
  return typeof connection.connectionId === "number"
    ? `${connection.provider}:${connection.connectionId}`
    : null;
}

/**
 * True when `next` shows a connection whose import has finished since `previous`: it was
 * processing, or it was not listed yet. Its accounts exist from then on.
 */
export function finishedImporting(
  previous: BankConnection[],
  next: BankConnection[],
): boolean {
  const before = new Map(
    previous.flatMap((connection) => {
      const id = connectionId(connection);
      return id ? [[id, connection.status] as const] : [];
    }),
  );
  return next.some((connection) => {
    const id = connectionId(connection);
    if (!id || connection.status === "processing") return false;
    const was = before.get(id);
    return was === undefined || was === "processing";
  });
}

/**
 * Polls while the newest Enable Banking connection, or any SimpleFIN connection, is still
 * importing its first sync, and refreshes everything that lists accounts when an import
 * finishes. That lives here, on the list, rather than in whichever dialog started the
 * connection: the dialog may be gone by then (Settings swaps its empty state for the table as
 * soon as the new connection is listed, and first-run moves on to its next step).
 */
export default function useBankConnections(options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: BANK_CONNECTIONS_QUERY_KEY,
    queryFn: async () => {
      const previous = queryClient.getQueryData<BankConnectionsResponse>(
        BANK_CONNECTIONS_QUERY_KEY,
      );
      const next = await getBankConnections();
      if (
        previous &&
        finishedImporting(previous.connections, next.connections)
      ) {
        void invalidateAccounts(queryClient);
      }
      return next;
    },
    enabled: options?.enabled ?? true,
    refetchInterval: ({ state }) =>
      state.dataUpdateCount < MAX_POLLS && isImporting(state.data?.connections)
        ? BANK_CONNECTIONS_POLL_INTERVAL_MS
        : false,
  });
}

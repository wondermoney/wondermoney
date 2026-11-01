import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export type SyncStaleness = "error" | "fresh" | "stale" | "very_stale";

export interface SyncStatus {
  staleness: SyncStaleness;
  lastSyncedAt: string | null;
  hasOpenIncident: boolean;
}

export interface Account {
  accountKey: number;
  accountName: string | null;
  accountFinancialInstitutionKey: {
    displayName: string | null;
    logoUrl: string | null;
  } | null;
  balance: number | null;
  currencyKey: { code: SupportedCurrencyCodes };
  appuserCurrencyBalance: number | null;
  accountOwnerAppuserKey: { currencyKey: { code: string } };
  refreshedAt: string | null;
  source: "manual" | "open_banking";
  /**
   * Which file the account's CSV import reads: its bank's statement export ("bank"), or the
   * generic CSV format, for any other bank or an account without one ("generic").
   */
  csvImportFormat: AccountCsvImportFormat;
  // Household sharing and per-account privacy
  isPrivate: boolean;
  isOwnedByViewer: boolean;
  ownerFirstName: string | null;
  /** Current balance net of pending transactions. Null when unknown. */
  availableBalance: number | null;
  appuserCurrencyAvailableBalance: number | null;
  /** Sync freshness signal for open-banking accounts. Null for manual/unknown. */
  syncStatus: SyncStatus | null;
}

export type AccountCsvImportFormat = "bank" | "generic";

export interface GetAccountsResponse {
  accounts: Account[];
}

export interface AccountWire {
  accountKey: number;
  accountName?: string | null;
  accountFinancialInstitutionKey?: {
    displayName?: string | null;
    logoUrl?: string | null;
  } | null;
  balance?: number | null;
  currencyKey: { code: string };
  appuserCurrencyBalance?: number | null;
  accountOwnerAppuserKey: { currencyKey: { code: string } };
  refreshedAt?: string | null;
  source?: string | null;
  csvImportFormat?: string | null;
  isPrivate?: boolean;
  isOwnedByViewer?: boolean;
  ownerFirstName?: string | null;
}

export interface GetAccountsWireResponse {
  accounts: AccountWire[];
}

const INVALID_ACCOUNTS_RESPONSE = "Invalid accounts response";

function invalidAccountsResponse(): Error {
  return new Error(INVALID_ACCOUNTS_RESPONSE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalidAccountsResponse();
  return value;
}

function normalizeNullableBalance(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidAccountsResponse();
  }
  return value;
}

function normalizeCurrencyCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw invalidAccountsResponse();
  }
  return value;
}

function normalizeAccountCurrencyCode(value: unknown): SupportedCurrencyCodes {
  return normalizeCurrencyCode(value) as SupportedCurrencyCodes;
}

const VALID_STALENESS = new Set<SyncStaleness>([
  "error",
  "fresh",
  "stale",
  "very_stale",
]);

// Lenient: these fields are additive, so an old/partial payload degrades to null rather than
// failing the whole accounts response.
function normalizeSyncStatus(value: unknown): SyncStatus | null {
  if (!isRecord(value)) return null;
  const staleness = value.staleness;
  if (
    typeof staleness !== "string" ||
    !VALID_STALENESS.has(staleness as SyncStaleness)
  ) {
    return null;
  }
  return {
    staleness: staleness as SyncStaleness,
    lastSyncedAt:
      typeof value.lastSyncedAt === "string" ? value.lastSyncedAt : null,
    hasOpenIncident: value.hasOpenIncident === true,
  };
}

function normalizeAccount(account: unknown): Account {
  if (!isRecord(account)) throw invalidAccountsResponse();

  const accountKey = account.accountKey;
  if (
    typeof accountKey !== "number" ||
    !Number.isFinite(accountKey) ||
    !Number.isInteger(accountKey) ||
    accountKey <= 0
  ) {
    throw invalidAccountsResponse();
  }

  const currencyKey = account.currencyKey;
  const owner = account.accountOwnerAppuserKey;
  if (
    !isRecord(currencyKey) ||
    !isRecord(owner) ||
    !isRecord(owner.currencyKey)
  ) {
    throw invalidAccountsResponse();
  }

  const institution = account.accountFinancialInstitutionKey;
  if (
    institution !== undefined &&
    institution !== null &&
    !isRecord(institution)
  ) {
    throw invalidAccountsResponse();
  }

  const refreshedAt = normalizeNullableString(account.refreshedAt);
  if (refreshedAt !== null && !Number.isFinite(Date.parse(refreshedAt))) {
    throw invalidAccountsResponse();
  }

  let source: Account["source"];
  if (account.source === undefined || account.source === null) {
    source = refreshedAt ? "open_banking" : "manual";
  } else if (account.source === "manual" || account.source === "open_banking") {
    source = account.source;
  } else {
    throw invalidAccountsResponse();
  }

  return {
    accountKey,
    accountName: normalizeNullableString(account.accountName),
    accountFinancialInstitutionKey:
      institution === undefined || institution === null
        ? null
        : {
            displayName: normalizeNullableString(institution.displayName),
            logoUrl: normalizeNullableString(institution.logoUrl),
          },
    balance: normalizeNullableBalance(account.balance),
    currencyKey: {
      code: normalizeAccountCurrencyCode(currencyKey.code),
    },
    appuserCurrencyBalance: normalizeNullableBalance(
      account.appuserCurrencyBalance,
    ),
    accountOwnerAppuserKey: {
      currencyKey: {
        code: normalizeCurrencyCode(owner.currencyKey.code),
      },
    },
    refreshedAt,
    // Transitional compatibility for payloads deployed before `source` existed.
    source,
    // Lenient: a missing or unknown value reads as the generic format.
    csvImportFormat: account.csvImportFormat === "bank" ? "bank" : "generic",
    // Household fields default off for payloads deployed before these existed.
    isPrivate: account.isPrivate === true,
    isOwnedByViewer: account.isOwnedByViewer === true,
    ownerFirstName: normalizeNullableString(account.ownerFirstName),
    availableBalance: normalizeNullableBalance(account.availableBalance),
    appuserCurrencyAvailableBalance: normalizeNullableBalance(
      account.appuserCurrencyAvailableBalance,
    ),
    syncStatus: normalizeSyncStatus(account.syncStatus),
  };
}

export function normalizeAccountsResponse(
  response: unknown,
): GetAccountsResponse {
  if (!isRecord(response) || !Array.isArray(response.accounts)) {
    throw invalidAccountsResponse();
  }

  return { accounts: response.accounts.map(normalizeAccount) };
}

/**
 * Fetches all accounts from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 * @example
 * ```tsx
 * // Server Component
 * const api = await getServerApi(locale)
 * const data = await getAccounts(api)
 *
 * // Client Component
 * const { data } = useAccounts()
 * ```
 */
export async function getAccounts(
  apiClient: AxiosInstance = api,
): Promise<GetAccountsResponse> {
  const response = await apiClient.get<GetAccountsWireResponse>("/v1/account");
  return normalizeAccountsResponse(response?.data);
}

export default function useAccounts<R = GetAccountsResponse>(
  options?: Omit<
    UseQueryOptions<GetAccountsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => getAccounts(),
    ...options,
  });
}

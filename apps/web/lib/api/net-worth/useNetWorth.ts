import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface RawNetWorthSummary {
  currencyCode: string;
  /** False when a row was left out because it could not be valued; absent from older APIs. */
  isComplete?: boolean;
  totalNetWorth: number;
  assets: { accounts: number; portfolios: number };
  liabilities: { loans: number };
  /**
   * A portfolio row with `countedInAccountId` is already inside that account's balance: it is a
   * breakdown and adds nothing to the totals. Absent from older APIs.
   */
  rows: Array<{
    type: string;
    id?: number;
    name: string;
    balance: number;
    countedInAccountId?: number;
  }>;
  /** Ask "Is this the same money?": an investment account no portfolio is linked to, and an unlinked portfolio. */
  suggestPortfolioLink?: boolean;
  /** Rows the API could not value in `currencyCode`; `accounts` is absent from older APIs. */
  unsupportedCurrencies: {
    accounts?: number;
    loans: number;
    portfolios: number;
  };
}

export interface NetWorth {
  netWorth: number;
  currencyCode?: string;
  assetsTotal?: number;
  liabilitiesTotal?: number;
  rows?: Array<{
    key: string;
    /** The account, portfolio or loan key behind the row, when the API sends it. */
    recordId?: number;
    label: string;
    amount: number;
    isLiability?: boolean;
    currencyCode?: string;
    /** Shown, but already counted in this account's balance. */
    countedInAccountId?: number;
    subRows?: Array<{
      key: string;
      label: string;
      amount: number;
      isLiability?: boolean;
      currencyCode?: string;
    }>;
  }>;
  unsupportedCurrencyMetadata?: Array<{ currencyCode: string; reason: string }>;
  suggestPortfolioLink?: boolean;
}

export interface GetNetWorthResponse {
  netWorth: NetWorth;
}

async function getNetWorth(
  apiClient: AxiosInstance = api,
): Promise<GetNetWorthResponse> {
  const { data } = await apiClient.get<RawNetWorthSummary>("/v1/net-worth");
  return {
    netWorth: {
      assetsTotal: data.assets.accounts + data.assets.portfolios,
      currencyCode: data.currencyCode,
      liabilitiesTotal: data.liabilities.loans,
      netWorth: data.totalNetWorth,
      rows: data.rows.map((row) => ({
        amount: row.balance,
        currencyCode: data.currencyCode,
        // Loans are always a liability regardless of sign, but an
        // offline account (no type field yet, see AccountCreateOfflineModal)
        // can only represent debt — a credit card or loan balance — by being
        // entered as negative. Flag it here too so it gets the same
        // liability treatment (e.g. the red account name in
        // DashboardNetworthTable) as a dedicated loan row.
        isLiability: row.type === "loans" || row.balance < 0,
        key: `${row.type}:${row.id ?? row.name}`,
        recordId: row.id,
        label: row.name,
        ...(row.countedInAccountId === undefined
          ? {}
          : { countedInAccountId: row.countedInAccountId }),
      })),
      suggestPortfolioLink: data.suggestPortfolioLink === true,
      unsupportedCurrencyMetadata: Object.entries(
        data.unsupportedCurrencies,
      ).flatMap(([currencyCode, count]) =>
        count > 0 ? [{ currencyCode, reason: "unsupported" }] : [],
      ),
    },
  };
}

export default function useNetWorth<R = GetNetWorthResponse>(
  options?: Omit<
    UseQueryOptions<GetNetWorthResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["net-worth"],
    queryFn: () => getNetWorth(),
    ...options,
  });
}

export type NetWorthHistoryReadiness =
  "ready" | "insufficient_history" | "empty";

export interface NetWorthHistoryPoint {
  date: string;
  accountsTotal: number | null;
  portfoliosTotal: number | null;
  loansTotal: number | null;
  totalNetWorth: number | null;
  isComplete: boolean;
}

export interface NetWorthHistoryResponse {
  currencyCode: string;
  granularity: "monthly";
  points: NetWorthHistoryPoint[];
  readiness: NetWorthHistoryReadiness;
}

export type NetWorthHistoryGranularity = NetWorthHistoryResponse["granularity"];

async function getNetWorthHistory(
  months = 6,
  granularity: NetWorthHistoryGranularity = "monthly",
  apiClient: AxiosInstance = api,
): Promise<NetWorthHistoryResponse> {
  const { data } = await apiClient.get<NetWorthHistoryResponse>(
    "/v1/net-worth/history",
    {
      params: {
        months,
        granularity,
      },
    },
  );

  return data;
}

export function useNetWorthHistory<R = NetWorthHistoryResponse>(
  months = 6,
  granularity: NetWorthHistoryGranularity = "monthly",
  options?: Omit<
    UseQueryOptions<NetWorthHistoryResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["net-worth-history", months, granularity],
    queryFn: () => getNetWorthHistory(months, granularity),
    ...options,
  });
}

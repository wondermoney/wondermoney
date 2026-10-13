import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface RawNetWorthSummary {
  currencyCode: string;
  totalNetWorth: number;
  assets: { accounts: number; portfolios: number };
  liabilities: { loans: number };
  rows: Array<{ type: string; name: string; balance: number }>;
  unsupportedCurrencies: { loans: number; portfolios: number };
}

export interface NetWorth {
  netWorth: number;
  currencyCode?: string;
  assetsTotal?: number;
  liabilitiesTotal?: number;
  rows?: Array<{
    key: string;
    label: string;
    amount: number;
    isLiability?: boolean;
    currencyCode?: string;
    subRows?: Array<{
      key: string;
      label: string;
      amount: number;
      isLiability?: boolean;
      currencyCode?: string;
    }>;
  }>;
  unsupportedCurrencyMetadata?: Array<{ currencyCode: string; reason: string }>;
}

export interface GetNetWorthResponse {
  netWorth: NetWorth;
}

export async function getNetWorth(
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
        // RAD-630: loans are always a liability regardless of sign, but an
        // offline account (no type field yet, see AccountCreateOfflineModal)
        // can only represent debt — a credit card or loan balance — by being
        // entered as negative. Flag it here too so it gets the same
        // liability treatment (e.g. the red account name in
        // DashboardNetworthTable) as a dedicated loan row.
        isLiability: row.type === "loans" || row.balance < 0,
        key: `${row.type}:${row.name}`,
        label: row.name,
      })),
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
  | "ready"
  | "insufficient_history"
  | "empty";

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

export async function getNetWorthHistory(
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

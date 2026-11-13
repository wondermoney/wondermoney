import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { MemberFilter } from "@/lib/household/member-attribution";

import api from "../api";

export interface RawNetWorthSummary {
  currencyCode: string;
  /** False when a row was left out because it could not be valued; absent from older APIs. */
  isComplete?: boolean;
  totalNetWorth: number;
  /** `manualAssets` (homes, vehicles and other manually valued assets) is absent from older APIs. */
  assets: { accounts: number; manualAssets?: number; portfolios: number };
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
  /** Rows the API could not value in `currencyCode`; `accounts` and `manualAssets` are absent from older APIs. */
  unsupportedCurrencies: {
    accounts?: number;
    loans: number;
    manualAssets?: number;
    portfolios: number;
  };
  /** The currencies of the accounts and loans left out for want of a rate; absent from older APIs. */
  unconvertedCurrencies?: string[];
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
  /**
   * What the totals leave out because it could not be valued in
   * `currencyCode`: how many accounts, loans and portfolios, and the
   * currencies with no exchange rate among them.
   */
  unconverted?: { count: number; currencies: string[] };
  suggestPortfolioLink?: boolean;
}

export interface GetNetWorthResponse {
  netWorth: NetWorth;
}

/**
 * @param member - One member's net worth (the accounts they own, not joint; their portfolios and
 *   manual assets; loans only when they are the viewer), or Shared's (joint accounts and a
 *   departed member's); null or absent for the household's.
 */
export async function getNetWorth(
  apiClient: AxiosInstance = api,
  member: MemberFilter = null,
): Promise<GetNetWorthResponse> {
  const { data } = await apiClient.get<RawNetWorthSummary>(
    "/v1/net-worth",
    member === null ? undefined : { params: { member: String(member) } },
  );
  return {
    netWorth: {
      assetsTotal:
        data.assets.accounts +
        data.assets.portfolios +
        (data.assets.manualAssets ?? 0),
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
      unconverted: {
        count:
          (data.unsupportedCurrencies.accounts ?? 0) +
          data.unsupportedCurrencies.loans +
          data.unsupportedCurrencies.portfolios,
        currencies: data.unconvertedCurrencies ?? [],
      },
    },
  };
}

export default function useNetWorth<R = GetNetWorthResponse>(
  options?: Omit<
    UseQueryOptions<GetNetWorthResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
  member: MemberFilter = null,
) {
  return useQuery({
    // The household's keeps the plain key, so its cache and invalidation are as before.
    queryKey: member === null ? ["net-worth"] : ["net-worth", { member }],
    queryFn: () => getNetWorth(undefined, member),
    ...options,
  });
}

export type NetWorthHistoryReadiness =
  "ready" | "insufficient_history" | "empty";

export interface NetWorthHistoryPoint {
  date: string;
  accountsTotal: number | null;
  portfoliosTotal: number | null;
  /** Manually valued assets; absent from older APIs. */
  manualAssetsTotal?: number | null;
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

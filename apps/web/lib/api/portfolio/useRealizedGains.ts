import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AmountsCompleteness } from "../completeness";

/** Totals of a set of sales, in the report's currency. */
export interface RealizedGainsTotals {
  costBasis: number;
  proceeds: number;
  realizedGain: number;
  sales: number;
}

/** One sale. Amounts are in `currencyCode`: the viewer's, unless no rate converts it. */
export interface RealizedDisposal {
  costBasis: number;
  currencyCode: string | null;
  /** ISO 8601. */
  date: string;
  /** Present (true) when a fee behind this sale could not be converted and counted as zero. */
  feeConversionIncomplete?: boolean;
  financialAssetKey: number;
  financialAssetName: string;
  /** The purchase date of the oldest lot the sale consumed, ISO 8601. */
  holdingPeriodStart: string | null;
  portfolioKey: number;
  portfolioName: string;
  /** Proceeds less the sale's fee. */
  proceeds: number;
  quantity: number;
  realizedGain: number;
  symbol: string;
  transactionKey: number;
}

export interface RealizedGainsByAsset extends RealizedGainsTotals {
  financialAssetKey: number;
  financialAssetName: string;
  quantity: number;
  symbol: string;
}

export interface RealizedGainsByYear extends RealizedGainsTotals {
  year: number;
}

/** An asset sold out of every portfolio in scope, with its lifetime result. */
export interface ClosedPosition extends RealizedGainsTotals {
  financialAssetKey: number;
  financialAssetLogoUrl: string | null;
  financialAssetName: string;
  financialAssetType: string;
  holdingPeriodStart: string | null;
  lastSaleDate: string;
  quantity: number;
  symbol: string;
}

/**
 * `disposals`, `byAsset` and `totals` cover the requested year (all years when
 * `year` is null); `byYear` and `closedPositions` cover the whole history.
 * Sales no rate converts are listed in their own currency and left out of the
 * totals (`completeness`).
 */
export interface RealizedGainsResponse {
  byAsset: RealizedGainsByAsset[];
  byYear: RealizedGainsByYear[];
  closedPositions: ClosedPosition[];
  completeness: AmountsCompleteness;
  currencyCode: string;
  disposals: RealizedDisposal[];
  feeConversionIncompleteAssetKeys?: number[];
  totals: RealizedGainsTotals;
  year: number | null;
}

async function getRealizedGains(
  portfolioId: number | null,
  year: number | null,
  apiClient: AxiosInstance = api,
): Promise<RealizedGainsResponse> {
  const { data } = await apiClient.get<RealizedGainsResponse>(
    "/v1/portfolio/realized-gains",
    {
      params: {
        ...(portfolioId ? { portfolioId } : {}),
        ...(year ? { year } : {}),
      },
    },
  );
  return data;
}

/** Realized gains for one portfolio (or all, with `null`) and one UTC year (or all). */
export default function useRealizedGains<R = RealizedGainsResponse>(
  portfolioId: number | null,
  year: number | null = null,
  options?: Omit<
    UseQueryOptions<RealizedGainsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["realized-gains", portfolioId, year],
    queryFn: () => getRealizedGains(portfolioId, year),
    ...options,
  });
}

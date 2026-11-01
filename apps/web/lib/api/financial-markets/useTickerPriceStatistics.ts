import { format, subDays } from "date-fns";
import { useMemo } from "react";

import useTickerHistoryPrice, {
  type HistoricalPrice,
  type HistoricalPriceResponse,
} from "./useTickerHistoryPrice";

export interface TickerPriceStatistics {
  lastClose: number;
  lastCloseDate: string;
  yearLow: number;
  yearHigh: number;
  /** Mean volume over the most recent sessions, or null when the series carries none. */
  averageVolume: number | null;
  /** Move from the oldest close in the window to the newest, in percent. */
  yearChangePercentage: number | null;
  /** Sessions the statistics were computed from — the reader deserves the basis. */
  sessions: number;
}

const AVERAGE_VOLUME_SESSIONS = 30;

/**
 * The statistics a year of end-of-day prices can answer on its own.
 *
 * Fundamentals are gated behind a higher market-data tier, so the fundamentals
 * panel has nothing from the provider to render. Half of what that panel
 * promises — 52-week range, average volume — is derivable from the EOD series
 * the plan does include, so it is computed here rather than left blank.
 */
export default function useTickerPriceStatistics(
  ticker: string | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  // Stable per mount so the query key does not churn on every render.
  const from = useMemo(() => format(subDays(new Date(), 365), "yyyy-MM-dd"), []);

  const query = useTickerHistoryPrice<TickerPriceStatistics | null>(
    ticker ?? "",
    from,
    undefined,
    false,
    {
      enabled: Boolean(ticker) && enabled,
      select: (response: HistoricalPriceResponse) =>
        selectPriceStatistics(response.companyHistoricalPrice.data),
      staleTime: 5 * 60_000,
      retry: 1,
    },
  );

  return {
    statistics: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** Exported for tests. */
export function selectPriceStatistics(
  points: HistoricalPrice[],
): TickerPriceStatistics | null {
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered.at(-1);
  const first = ordered[0];
  if (!last || !first) return null;

  // Intraday extremes when the provider sends them, closes when it does not —
  // a 52-week range computed from closes is still a true range, just a tighter
  // one, and is better than no range at all.
  const highs = ordered.map((point) => point.high ?? point.close);
  const lows = ordered.map((point) => point.low ?? point.close);
  const volumes = ordered
    .slice(-AVERAGE_VOLUME_SESSIONS)
    .map((point) => point.volume)
    .filter((volume): volume is number => volume != null && volume > 0);

  return {
    lastClose: last.close,
    lastCloseDate: last.date,
    yearLow: Math.min(...lows),
    yearHigh: Math.max(...highs),
    averageVolume: volumes.length
      ? volumes.reduce((total, volume) => total + volume, 0) / volumes.length
      : null,
    yearChangePercentage:
      first.close === 0 ? null : ((last.close - first.close) / first.close) * 100,
    sessions: ordered.length,
  };
}

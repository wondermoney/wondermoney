import { format, subDays } from "date-fns";
import { useMemo } from "react";

import useTickerHistoryPrice, {
  type HistoricalPrice,
  type HistoricalPriceResponse,
} from "./useTickerHistoryPrice";

export interface TickerLastClose {
  /** Most recent close in the series. */
  close: number;
  /** The close before it, when the window holds one. */
  previousClose: number | null;
  /** Day-over-day move, in percent, or null without a previous close. */
  changePercentage: number | null;
  /** ISO date (yyyy-MM-dd) the close belongs to. */
  date: string;
}

/**
 * Last close and day-over-day move, derived from the price history.
 *
 * The market-data source carries no live quote, but the history plots closes
 * right up to yesterday, so the header reads the tail of the history instead of
 * showing two bare em dashes. It is explicitly *not*
 * a quote: callers must label what it is and when it is from.
 */
export default function useTickerLastClose(
  ticker: string | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  // Stable for the lifetime of the mount so the query key does not churn. A
  // month of calendar days comfortably clears any run of market holidays.
  const from = useMemo(() => format(subDays(new Date(), 30), "yyyy-MM-dd"), []);

  const query = useTickerHistoryPrice<TickerLastClose | null>(
    ticker ?? "",
    from,
    undefined,
    false,
    {
      enabled: Boolean(ticker) && enabled,
      select: (response: HistoricalPriceResponse) =>
        selectLastClose(response.companyHistoricalPrice.data),
      staleTime: 5 * 60_000,
      retry: 1,
    },
  );

  return query.data ?? null;
}

/** Exported for tests: the series may arrive in either direction. */
export function selectLastClose(
  points: HistoricalPrice[],
): TickerLastClose | null {
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered.at(-1);
  if (!last) return null;

  const previous = ordered.at(-2) ?? null;
  const previousClose = previous?.close ?? null;

  return {
    close: last.close,
    previousClose,
    // A previous close of zero would make the percentage meaningless rather
    // than infinite, so it is treated as "no basis to compare against".
    changePercentage:
      previousClose === null || previousClose === 0
        ? null
        : ((last.close - previousClose) / previousClose) * 100,
    date: last.date,
  };
}

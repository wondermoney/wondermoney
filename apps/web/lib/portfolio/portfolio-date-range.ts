import { format, startOfYear, subMonths } from "date-fns";

import type { Period } from "@/lib/api/portfolio/usePortfolioDashboard";

/**
 * The first day of a portfolio metrics period, as a calendar day (`yyyy-MM-dd`) on the viewer's
 * calendar. Not an instant range (`dateRangeParams`): the API compares it with the `date` column
 * of daily portfolio snapshots, and a viewer's-midnight timestamp west of UTC would leave out the
 * snapshot of the first day.
 *
 * @see lib/api/date-range.ts
 */
export function getPortfolioFromDate(
  period: Period,
  now = new Date(),
): string | undefined {
  switch (period) {
    case "1M":
      return format(subMonths(now, 1), "yyyy-MM-dd");
    case "3M":
      return format(subMonths(now, 3), "yyyy-MM-dd");
    case "6M":
      return format(subMonths(now, 6), "yyyy-MM-dd");
    case "YTD":
      return format(startOfYear(now), "yyyy-MM-dd");
    case "1Y":
      return format(subMonths(now, 12), "yyyy-MM-dd");
    case "ALL":
      return undefined;
    default:
      return format(startOfYear(now), "yyyy-MM-dd");
  }
}

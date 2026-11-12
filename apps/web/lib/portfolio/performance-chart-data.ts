import type {
  PerformanceDataPoint,
  PerformanceValueDataPoint,
} from "@/lib/api/portfolio/usePortfolioPerformance";

/** Which way money moved on a day with a trade. */
export type PortfolioFlowKind = "deposit" | "withdrawal" | "unknown";

/**
 * The flow a value point marks, if any. `undefined` is a day with no trade;
 * `null` a trade whose amount has no rate in the viewer's currency. A zero net
 * (a buy and a sale that cancel out) moved no money in or out, so it is not
 * marked.
 */
export function flowKindOf(
  netContribution: number | null | undefined,
): PortfolioFlowKind | null {
  if (netContribution === undefined) return null;
  if (netContribution === null) return "unknown";
  if (netContribution > 0) return "deposit";
  if (netContribution < 0) return "withdrawal";
  return null;
}

export interface ValueChartPoint {
  x: string;
  portfolio: number;
  netContribution?: number | null;
  flow: PortfolioFlowKind | null;
}

/** The value view: one point per snapshot day, flow days tagged for a marker. */
export function buildValueChartData(
  dataPoints: PerformanceValueDataPoint[] | undefined,
): ValueChartPoint[] {
  return (dataPoints ?? []).map((point) => ({
    x: point.date,
    portfolio: point.value,
    netContribution: point.netContribution,
    flow: flowKindOf(point.netContribution),
  }));
}

export interface ReturnChartPoint {
  x: string;
  portfolioReturn?: number;
  benchmarkReturn?: number;
}

/**
 * The percentage view, merged by date. The time-weighted series has no point
 * on a day it could not measure, so a day only one series has leaves the other
 * undefined (a gap the line bridges), never 0: a missing day must not read as
 * a fall to the start.
 */
export function buildReturnChartData(
  portfolio: PerformanceDataPoint[] | undefined,
  benchmark: PerformanceDataPoint[] | undefined,
): ReturnChartPoint[] {
  if (!portfolio?.length) return [];

  const portfolioByDate = new Map(
    portfolio.map((point) => [point.date, point.value]),
  );
  const benchmarkByDate = new Map(
    benchmark?.map((point) => [point.date, point.value]) ?? [],
  );

  // `YYYY-MM-DD` sorts as text in date order.
  return Array.from(
    new Set([...portfolioByDate.keys(), ...benchmarkByDate.keys()]),
  )
    .toSorted()
    .map((date) => ({
      x: date,
      portfolioReturn: portfolioByDate.get(date),
      benchmarkReturn: benchmarkByDate.get(date),
    }));
}

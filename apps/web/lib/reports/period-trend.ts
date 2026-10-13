/**
 * Change between two periods, for the reports' trend indicators.
 *
 * Both the spending and net-worth reports computed this inline and both got
 * the same thing wrong: with a zero baseline they reported `percent: 0`, so
 * the indicator printed "0%" beside a non-zero delta — telling the reader
 * spending was flat while the figure next to it said otherwise.
 *
 * A percentage change from zero is undefined, not zero. `undefined` is what
 * `ReportTrendIndicator` already expects when there is no percentage to show:
 * it omits the percentage and takes its direction and colour from the delta.
 */
export type PeriodTrend = Readonly<{
  delta: number;
  /** `undefined` when there is no basis to compute a ratio against. */
  percent: number | undefined;
}>;

export function periodTrend(current: number, prior: number): PeriodTrend {
  const delta = current - prior;
  return {
    delta,
    percent:
      prior !== 0
        ? Number(((delta / Math.abs(prior)) * 100).toFixed(1))
        : undefined,
  };
}

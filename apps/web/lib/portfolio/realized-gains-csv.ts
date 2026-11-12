import type { RealizedDisposal } from "@/lib/api/portfolio/useRealizedGains";

/** Column headers, in the viewer's language. */
export interface RealizedGainsCsvLabels {
  asset: string;
  costBasis: string;
  currency: string;
  date: string;
  heldSince: string;
  name: string;
  portfolio: string;
  proceeds: string;
  quantity: string;
  realizedGain: string;
}

/** The columns in file order. */
export function realizedGainsCsvColumns(labels: RealizedGainsCsvLabels) {
  return [
    labels.date,
    labels.portfolio,
    labels.asset,
    labels.name,
    labels.quantity,
    labels.proceeds,
    labels.costBasis,
    labels.realizedGain,
    labels.currency,
    labels.heldSince,
  ];
}

/** A UTC calendar day, as sales are dated and the year filter reads them. */
const utcDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * One CSV row per sale, in the order given (the on-screen list's order).
 * Amounts are plain decimals with a dot and two places, so a spreadsheet in
 * any locale reads them as numbers; the currency is its own column.
 */
export function realizedGainsCsvRows(
  disposals: RealizedDisposal[],
  labels: RealizedGainsCsvLabels,
): Record<string, string>[] {
  return disposals.map((disposal) => ({
    [labels.date]: utcDay(disposal.date),
    [labels.portfolio]: disposal.portfolioName,
    [labels.asset]: disposal.symbol,
    [labels.name]: disposal.financialAssetName,
    [labels.quantity]: String(disposal.quantity),
    [labels.proceeds]: disposal.proceeds.toFixed(2),
    [labels.costBasis]: disposal.costBasis.toFixed(2),
    [labels.realizedGain]: disposal.realizedGain.toFixed(2),
    [labels.currency]: disposal.currencyCode ?? "",
    [labels.heldSince]: utcDay(disposal.holdingPeriodStart),
  }));
}

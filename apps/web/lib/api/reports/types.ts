/**
 * Reports API contract types.
 *
 * Mirrors the shared filter envelope, response envelope, and row shapes of the
 * `/v1/reports/*` endpoints. All amounts are raw numbers in the appuser
 * currency — formatting is a UI concern.
 */

import type { AmountsCompleteness } from "../completeness";

/**
 * Shared report filter envelope.
 *
 * Mirrors `ReportFiltersSchema` on the API (`api/src/validators/reports.ts`).
 * `fromDate`/`toDate` are ISO datetime strings with offset; every other filter
 * is optional. Defaults (`includePending: false`, `includeTransfers: false`)
 * are applied server-side.
 */
export interface ReportFilters {
  fromDate?: string;
  toDate?: string;
  accountKeys?: string[];
  categoryKeys?: string[];
  merchantKeys?: string[];
  /** Tag keys; a transaction counts when it carries any of them. */
  tagKeys?: string[];
  currencyKey?: string;
  includePending?: boolean;
  includeTransfers?: boolean;
  /**
   * IANA name of the calendar report periods are grouped in.
   *
   * The API validates it and answers 400 on a name `Intl` cannot resolve, so
   * only send one you know is good; omitting it selects the API's documented
   * default (`Europe/Lisbon`). Whichever applies is echoed back in the response
   * `filters`, so the answer always says which calendar it was computed in.
   *
   * @see lib/reports/viewer-timezone.ts
   */
  timezone?: string;
}

/** Response format for the exportable report endpoints. */
export type ReportFormat = "json" | "csv";

/** Generic report response envelope. */
export interface ReportResponse<T> {
  /**
   * Whether every row could be valued in the viewer's currency. Rows in a
   * currency with no exchange rate are left out of `data` and counted here.
   * Sent by the spending, cash flow, Sankey and budget reports.
   */
  completeness?: AmountsCompleteness;
  data: T;
  generatedAt: string;
  filters: ReportFilters;
}

/** Row shape for `GET /v1/reports/spending-by-category`. */
export interface SpendingByCategoryRow {
  categoryKey: string;
  parentKey: string | null;
  name: string;
  color: string;
  totalAmount: number;
  transactionCount: number;
  percentOfTotal: number;
}

/** Point shape for `GET /v1/reports/cashflow`. */
export interface CashflowPoint {
  month: string;
  income: number;
  expenses: number;
  net: number;
  /** `(income - expenses) / income`; null when the month has no income. */
  savingsRate?: number | null;
}

/** Graph shape for `GET /v1/reports/sankey`. */
export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/** Node in the Sankey flow graph. */
export interface SankeyNode {
  id: string;
  label: string;
  kind: "income" | "expense" | "account";
  color?: string;
  value?: number;
}

/** Link between two Sankey nodes (absolute amount). */
export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

/** Point shape for `GET /v1/reports/net-worth-history`. */
export interface NetWorthPoint {
  date: string;
  netWorth: number;
  breakdown: {
    assets: number;
    liabilities: number;
  };
}

/** Row shape for `GET /v1/reports/budget-vs-actual`. */
export interface BudgetVsActualRow {
  categoryKey: string;
  name: string;
  color: string;
  budgeted: number;
  actual: number;
  variance: number;
  percentUsed: number;
}

/**
 * Row shape for `GET /v1/reports/portfolio-performance`: one household
 * portfolio over the period, every amount in the appuser currency.
 * `change = endValue - startValue - netContributions`; a value the API cannot
 * know (no snapshot) is `null`, and so is any figure derived from it.
 */
export interface PortfolioPerformanceRow {
  portfolioKey: string;
  name: string;
  currency: string;
  /** Value when the period opens; 0 for a portfolio started within it. */
  startValue: number | null;
  /**
   * Buys minus sales in the period (fees included), each converted at the
   * rate of its date; null when one has no rate.
   */
  netContributions: number | null;
  change: number | null;
  /** `change` as a % of start value plus net contributions, when positive. */
  changePercent: number | null;
  /** Dividends paid in the period, reported beside the change; null when one has no rate. */
  dividends: number | null;
  /** Value when the period closes: live for a current period. */
  endValue: number | null;
}

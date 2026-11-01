/**
 * Reports API contract types.
 *
 * Mirrors the shared filter envelope, response envelope, and row shapes of the
 * `/v1/reports/*` endpoints. All amounts are raw numbers in the appuser
 * currency — formatting is a UI concern.
 */

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

/** Row shape for `GET /v1/reports/portfolio-performance`. */
export interface PortfolioPerformanceRow {
  accountKey: string;
  name: string;
  currency: string;
  startBalance: number;
  endBalance: number;
  return: number;
  contributions: number;
}

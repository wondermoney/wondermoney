/**
 * Reports API client public surface (RAD-156).
 *
 * Request functions (with optional injected axios client and CSV variant via
 * `format: "csv"`), hooks, query keys, and contract types.
 */
export {
  getBudgetVsActual,
  type GetBudgetVsActualRequest,
  default as useBudgetVsActual,
} from "./budgetVsActual";
export {
  getCashflow,
  type GetCashflowRequest,
  default as useCashflow,
} from "./cashflow";
export * from "./keys";
export {
  getNetWorthHistory,
  type GetNetWorthHistoryRequest,
  default as useNetWorthHistory,
} from "./netWorthHistory";
export {
  getPortfolioPerformance,
  type GetPortfolioPerformanceRequest,
  default as usePortfolioPerformance,
} from "./portfolioPerformance";
export {
  getSankey,
  type GetSankeyRequest,
  default as useSankey,
} from "./sankey";
export {
  getSpendingByCategory,
  type GetSpendingByCategoryRequest,
  default as useSpendingByCategory,
} from "./spendingByCategory";
export * from "./types";

import type { ReportFilters } from "./types";

/**
 * Central query-key vocabulary for the reports domain.
 *
 * Every report endpoint shares the same filter envelope, so each key names the
 * endpoint segment and includes the filters that change the result.
 */
export const reportsKeys = {
  all: ["reports"] as const,
  spendingByCategory: (params: ReportFilters) =>
    [...reportsKeys.all, "spending-by-category", params] as const,
  cashflow: (params: ReportFilters) =>
    [...reportsKeys.all, "cashflow", params] as const,
  sankey: (params: ReportFilters) =>
    [...reportsKeys.all, "sankey", params] as const,
  netWorthHistory: (params: ReportFilters) =>
    [...reportsKeys.all, "net-worth-history", params] as const,
  budgetVsActual: (params: ReportFilters) =>
    [...reportsKeys.all, "budget-vs-actual", params] as const,
  portfolioPerformance: (params: ReportFilters) =>
    [...reportsKeys.all, "portfolio-performance", params] as const,
} as const;

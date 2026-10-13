import type { QueryClient } from "@tanstack/react-query";

/**
 * Centralized query invalidation helpers to reduce duplication across components
 */

export const invalidateAccounts = async (qc: QueryClient) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["account"] }),
    qc.invalidateQueries({ queryKey: ["accounts"] }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions"] }),
    qc.invalidateQueries({ queryKey: ["account-transactions"] }),
    qc.invalidateQueries({ queryKey: ["accounts-metrics"] }),
    qc.invalidateQueries({ queryKey: ["account-metrics"] }),
    qc.invalidateQueries({ queryKey: ["accounts-cashflow"] }),
    qc.invalidateQueries({ queryKey: ["categories"] }),
    qc.invalidateQueries({ queryKey: ["transactions-category-spending"] }),
    qc.invalidateQueries({ queryKey: ["net-worth"] }),
  ]);
};

interface InvalidateBudgetsOptions {
  refresh?: () => void;
}

export const invalidateBudgets = async (
  qc: QueryClient,
  options?: InvalidateBudgetsOptions,
) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["budgets"] }),
    qc.invalidateQueries({ queryKey: ["budgets-full"] }),
    qc.invalidateQueries({ queryKey: ["budget"] }),
    qc.invalidateQueries({ queryKey: ["budget-template"] }),
    qc.invalidateQueries({ queryKey: ["budget-template-year"] }),
    qc.invalidateQueries({ queryKey: ["budget-template-year-month"] }),
    qc.invalidateQueries({ queryKey: ["budget-template-year-until-month"] }),
    qc.invalidateQueries({ queryKey: ["budget-accounts"] }),
    qc.invalidateQueries({ queryKey: ["budgets-transactions"] }),
    qc.invalidateQueries({ queryKey: ["budgets-metrics"] }),
  ]);
  options?.refresh?.();
};

export const invalidateCategories = async (qc: QueryClient) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["categories"] }),
    qc.invalidateQueries({ queryKey: ["configs"] }),
    qc.invalidateQueries({ queryKey: ["transactions-category-spending"] }),
  ]);
};

export const invalidatePortfolios = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["portfolios"] });
  qc.invalidateQueries({ queryKey: ["portfolio"] });
  qc.invalidateQueries({ queryKey: ["portfolio-holdings"] });
  qc.invalidateQueries({ queryKey: ["portfolios-holdings"] });
  qc.invalidateQueries({ queryKey: ["portfolio-transactions"] });
  qc.invalidateQueries({ queryKey: ["portfolio-metrics"] });
  qc.invalidateQueries({ queryKey: ["portfolio-calendar"] });
  qc.invalidateQueries({ queryKey: ["dividend-income"] });
};

export const invalidatePortfolioDetail = (
  qc: QueryClient,
  portfolioId?: number,
) => {
  qc.invalidateQueries({ queryKey: ["portfolio-dashboard"] });
  qc.invalidateQueries({ queryKey: ["portfolio-performance"] });
  qc.invalidateQueries({ queryKey: ["portfolio-top-movers"] });
  qc.invalidateQueries({ queryKey: ["portfolio-allocation"] });
  qc.invalidateQueries({ queryKey: ["portfolio-holdings"] });
  qc.invalidateQueries({ queryKey: ["portfolio-transactions"] });
  qc.invalidateQueries({ queryKey: ["portfolios-transactions"] });
  if (portfolioId !== undefined) {
    qc.invalidateQueries({ queryKey: ["portfolio-dashboard", portfolioId] });
    qc.invalidateQueries({ queryKey: ["portfolio-performance", portfolioId] });
    qc.invalidateQueries({ queryKey: ["portfolio-top-movers", portfolioId] });
    qc.invalidateQueries({ queryKey: ["portfolio-allocation", portfolioId] });
    qc.invalidateQueries({ queryKey: ["portfolio-holdings", portfolioId] });
    qc.invalidateQueries({
      queryKey: ["portfolio-transactions", { portfolioId }],
    });
    qc.invalidateQueries({ queryKey: ["portfolios-transactions", { portfolioId }] });
  }
  qc.invalidateQueries({ queryKey: ["portfolio-history-status"] });
  qc.invalidateQueries({ queryKey: ["portfolio"] });
};

export const invalidateTransactions = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["accounts-transactions"] });
  qc.invalidateQueries({ queryKey: ["account-transactions"] });
  qc.invalidateQueries({ queryKey: ["accounts-metrics"] });
  qc.invalidateQueries({ queryKey: ["account-metrics"] });
  qc.invalidateQueries({ queryKey: ["accounts-cashflow"] });
  qc.invalidateQueries({ queryKey: ["transactions-category-spending"] });
  qc.invalidateQueries({ queryKey: ["net-worth"] });
};

export const invalidateRecurring = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["recurring-items"] });
  qc.invalidateQueries({ queryKey: ["recurring-summary"] });
};

export const invalidateRequisitions = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["requisitions"] });
  qc.invalidateQueries({ queryKey: ["requisition"] });
};

export const invalidateUser = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["user"] });
  qc.invalidateQueries({ queryKey: ["onboarding"] });
};

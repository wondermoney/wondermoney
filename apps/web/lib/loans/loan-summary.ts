import type { LoanDetail } from "@/lib/api/loan/types";

export interface LoanSummary {
  principal: number;
  outstanding: number;
  payment: number;
  /** Basis points, as the API sends it. */
  rate: number;
  remaining: number | null;
  /** 0..100. */
  progress: number;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/**
 * The loan detail page's figures.
 *
 * Progress is the API's `progressPercentage` whenever it sends one: the API
 * picks the basis (`progressBasis`, e.g. the original principal) and the
 * page used to recompute it against the opening balance instead, which for a
 * loan tracked part-way through read as 0% repaid on a mortgage 23% paid off.
 * The opening-balance figure is kept only as the fallback for a response
 * without it.
 */
export function loanSummary(loan: LoanDetail): LoanSummary {
  const principal = loan.openingPrincipalBalance ?? 0;
  const outstanding = loan.outstandingPrincipal ?? 0;
  const fromOpening =
    principal > 0 ? ((principal - outstanding) / principal) * 100 : 0;
  const progress =
    typeof loan.progressPercentage === "number" &&
    Number.isFinite(loan.progressPercentage)
      ? loan.progressPercentage
      : fromOpening;

  return {
    principal,
    outstanding,
    payment: loan.regularPaymentAmount ?? 0,
    rate: loan.annualInterestRateBps ?? 0,
    remaining: loan.remainingTermMonthsEstimated ?? loan.termMonths ?? null,
    progress: clamp(progress),
  };
}

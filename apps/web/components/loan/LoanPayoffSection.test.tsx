// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoanDetail } from "@/lib/api/loan/types";

import loansMessages from "../../messages/en/loans.json";
import LoanPayoffSection from "./LoanPayoffSection";

vi.mock("@/lib/api/loan/useLoanProjection", () => ({
  default: (_loanId: number, filters: { extra?: number }) => {
    const extra = filters.extra ?? 0;
    const withExtra = extra > 0;
    return {
      data: {
        projection: {
          aheadOrBehindMonths: withExtra ? 4 : 0,
          contractInterest: 100,
          contractMonths: 12,
          interestSaved: withExtra ? 40 : 0,
          months: withExtra ? 8 : 12,
          monthsSaved: withExtra ? 4 : 0,
          payoffDate: withExtra ? "2027-05-15" : "2027-09-15",
          paysOff: true,
          reason: null,
          series: Array.from({ length: withExtra ? 9 : 13 }, (_, month) => ({
            baselineBalance: 1000 - month * 80,
            date: new Date(Date.UTC(2026, month, 15)).toISOString(),
            month,
            withExtraBalance: withExtra ? 1000 - month * 120 : 1000 - month * 80,
          })),
          totalInterest: withExtra ? 60 : 100,
        },
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    };
  },
}));

vi.mock("@/components/ui/charts", () => ({
  AreaLineChartBase: ({ data }: { data: object[] }) => (
    <div data-testid="payoff-chart" data-points={data.length} />
  ),
  useChartFormatters: () => ({
    formatCompactCurrency: (value: number) => String(value),
  }),
}));

const loan: LoanDetail = {
  annualInterestRateBps: 1200,
  currency: { code: "EUR", currencyKey: 1 },
  includeInNetWorth: true,
  loanKey: 7,
  name: "Car loan",
  openingBalanceDate: "2026-01-01",
  openingPrincipalBalance: 1_000,
  originalPrincipal: 1_000,
  outstandingPrincipal: 1_000,
  securedAsset: null,
  status: "ACTIVE",
  type: "AUTO_LOAN",
};

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={loansMessages}>
      <LoanPayoffSection loan={loan} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("LoanPayoffSection", () => {
  it("shows the contract-only payoff and the baseline balance line", () => {
    renderSection();

    expect(screen.getByText("Payoff projection")).toBeTruthy();
    expect(screen.getByText("Sep 15, 2027")).toBeTruthy();
    expect(screen.getByTestId("payoff-chart").getAttribute("data-points")).toBe("13");
  });

  it("updates the payoff, months saved and interest saved as the user types an extra", async () => {
    renderSection();

    fireEvent.change(screen.getByLabelText("Extra monthly payment"), {
      target: { value: "100" },
    });

    await waitFor(() =>
      expect(screen.getByText("May 15, 2027")).toBeTruthy(),
    );
    expect(screen.getByText("4 months")).toBeTruthy();
    expect(screen.getByText("40.00")).toBeTruthy();
    expect(screen.getByTestId("payoff-chart").getAttribute("data-points")).toBe("9");
  });
});

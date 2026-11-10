import assert from "node:assert/strict";

import { test } from "vitest";

import type { LoanDetail } from "@/lib/api/loan/types";

import { loanSummary } from "./loan-summary";

function loan(overrides: Partial<LoanDetail>): LoanDetail {
  return {
    loanKey: 1,
    name: "Home mortgage",
    type: "MORTGAGE",
    status: "ACTIVE",
    currency: { currencyKey: 151, code: "EUR" },
    openingPrincipalBalance: 142350,
    outstandingPrincipal: 142030,
    includeInNetWorth: true,
    ...overrides,
  } as LoanDetail;
}

test("progress is the API's own figure, on the basis it chose", () => {
  // The demo mortgage: 23% of the original EUR 185,000 is repaid, though only
  // EUR 320 has gone since tracking began at EUR 142,350.
  const summary = loanSummary(
    loan({ originalPrincipal: 185000, progressPercentage: 23.227027027027027 }),
  );

  assert.ok(Math.abs(summary.progress - 23.227027027027027) < 1e-9);
});

test("without an API figure, progress is measured from the opening balance", () => {
  const summary = loanSummary(
    loan({ openingPrincipalBalance: 10000, outstandingPrincipal: 7500 }),
  );

  assert.equal(summary.progress, 25);
});

test("progress stays between 0 and 100", () => {
  assert.equal(loanSummary(loan({ progressPercentage: 130 })).progress, 100);
  assert.equal(loanSummary(loan({ progressPercentage: -4 })).progress, 0);
  assert.equal(
    loanSummary(
      loan({ openingPrincipalBalance: 1000, outstandingPrincipal: 1200 }),
    ).progress,
    0,
  );
  assert.equal(loanSummary(loan({ openingPrincipalBalance: 0 })).progress, 0);
});

test("the other figures pass through, and remaining term prefers the estimate", () => {
  const summary = loanSummary(
    loan({
      regularPaymentAmount: 600,
      annualInterestRateBps: 392,
      remainingTermMonthsEstimated: 456,
      termMonths: 340,
    }),
  );

  assert.deepEqual(
    {
      outstanding: summary.outstanding,
      payment: summary.payment,
      rate: summary.rate,
      remaining: summary.remaining,
    },
    { outstanding: 142030, payment: 600, rate: 392, remaining: 456 },
  );
  assert.equal(loanSummary(loan({ termMonths: 340 })).remaining, 340);
  assert.equal(loanSummary(loan({})).remaining, null);
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";

import type { LoanRepaymentCandidate } from "@/lib/api/loan/types";

import en from "../../messages/en/loans.json";
import es from "../../messages/es/loans.json";
import pt from "../../messages/pt/loans.json";
import RepaymentCandidateList from "./RepaymentCandidateList";

const candidate = {
  amount: 950,
  candidateScore: 60,
  confidence: "MEDIUM",
  outstandingPrincipal: 180000,
  reasons: ["amount_match"],
  transaction: {
    transactionKey: 82,
    description: "Monthly loan payment",
    merchantName: "Example lender",
    transactionDate: "2026-07-05T10:00:00.000Z",
    settlementAmount: -950,
    accountName: "Current account",
    currencyCode: "USD",
  },
} satisfies LoanRepaymentCandidate;

function renderCandidate(
  value: LoanRepaymentCandidate = candidate,
  locale = "en",
) {
  const onSelect = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={{ en, pt, es }[locale]}>
      <RepaymentCandidateList candidates={[value]} onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

afterEach(cleanup);

it("shows the API transaction's details and selects its transaction key", () => {
  const onSelect = renderCandidate();
  expect(screen.getByText("Current account")).toBeTruthy();
  expect(screen.getByText("Monthly loan payment")).toBeTruthy();
  expect(document.body.textContent).toContain("950.00");
  expect(document.body.textContent).toContain("$");
  expect(document.body.textContent).not.toContain("Account unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Link repayment" }));
  expect(onSelect).toHaveBeenCalledWith(82);
});

it.each([
  ["en", "HIGH", "High"],
  ["en", "MEDIUM", "Medium"],
  ["en", "LOW", "Low"],
  ["pt", "HIGH", "Alta"],
  ["pt", "MEDIUM", "Média"],
  ["pt", "LOW", "Baixa"],
  ["es", "HIGH", "Alta"],
  ["es", "MEDIUM", "Media"],
  ["es", "LOW", "Baja"],
] as const)(
  "translates %s confidence %s without a percent sign",
  (locale, confidence, label) => {
    renderCandidate({ ...candidate, confidence }, locale);
    expect(screen.getByText(new RegExp(`: ${label}$`))).toBeTruthy();
    expect(document.body.textContent).not.toContain("%");
  },
);

it.each([0, 85])(
  "keeps numeric confidence %s as a percentage",
  (confidence) => {
    renderCandidate({ ...candidate, confidence });
    expect(screen.getByText(`Confidence: ${confidence}%`)).toBeTruthy();
  },
);

it("uses unavailable copy for missing account and confidence", () => {
  renderCandidate({
    ...candidate,
    confidence: null,
    transaction: { ...candidate.transaction, accountName: null },
  });
  expect(screen.getByText("Account unavailable")).toBeTruthy();
  expect(screen.getByText("Confidence: unavailable")).toBeTruthy();
});

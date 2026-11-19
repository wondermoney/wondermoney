// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEPOSIT_RATES_EXAMPLE, computeDepositBenchmark, latestRates } from "@/lib/calculators/depositRates";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/term-deposit-rate-index-portugal",
}));

const { default: DepositRateIndexComp } = await import("./DepositRateIndexComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

const eur = (value: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(
    value,
  );

it("shows the latest rates, the calculator example and reports one edit with metadata only", () => {
  const outcome = computeDepositBenchmark({ ...DEPOSIT_RATES_EXAMPLE });
  if (!outcome.ok) throw new Error("example must be valid");
  const latest = latestRates();

  render(<DepositRateIndexComp locale="en" />);
  expect(screen.getAllByText(`${latest.pt.all?.toFixed(2)}%`).length).toBeGreaterThan(0);
  expect(screen.getAllByText(`${latest.ea.all?.toFixed(2)}%`).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/not the best offer/).length).toBeGreaterThan(0);
  expect(document.body.textContent).toContain(eur(outcome.result.deposit.netInterest));
  expect(screen.getAllByRole("table").length).toBe(2);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // An empty amount gives a clear message and no stale result.
  const amount = screen.getByLabelText("Amount deposited");
  fireEvent.change(amount, { target: { value: "" } });
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("Enter an amount above zero.")).toBeTruthy();
  expect(screen.getByText("Check the highlighted fields to see the result.")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // A term past the limit.
  fireEvent.change(amount, { target: { value: "5000" } });
  const term = screen.getByLabelText(/^Term/);
  fireEvent.change(term, { target: { value: "200" } });
  expect(screen.getByText("The term can be at most 120 months.")).toBeTruthy();

  // A long term falls in the over-2-years group.
  fireEvent.change(term, { target: { value: "36" } });
  expect(screen.getAllByText(/Over 2 years/).length).toBeGreaterThan(0);

  // Inflation out of range.
  const inflation = screen.getByLabelText("Assumed inflation per year");
  fireEvent.change(inflation, { target: { value: "90" } });
  expect(screen.getByText("Enter an inflation rate from -10% to 50%.")).toBeTruthy();
  fireEvent.change(inflation, { target: { value: "2" } });

  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "deposit_rate_index",
    page_type: "tools/term-deposit-rate-index-portugal",
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SP500_HISTORY_EXAMPLE, computeSp500History } from "@/lib/calculators/sp500History";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/sp500-historical-returns-calculator",
}));

const { default: Sp500HistoryCalculatorComp } = await import("./Sp500HistoryCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

const usd = (value: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

it("shows the example, explains edge cases and reports one edit with metadata only", () => {
  const outcome = computeSp500History(SP500_HISTORY_EXAMPLE);
  if (!outcome.ok) throw new Error("example must be valid");

  render(<Sp500HistoryCalculatorComp locale="en" />);
  expect(document.body.textContent).toContain(usd(outcome.result.finalValue));
  expect(screen.getAllByText(/euro-dollar exchange rate/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Past performance does not predict/)).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // End before start: a clear message and no stale result.
  const end = screen.getByLabelText("End year (to 31 December)");
  fireEvent.change(end, { target: { value: "1999" } });
  expect(end.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("The end year must be 2000 or later.")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // A single year gets its caution.
  fireEvent.change(end, { target: { value: "2000" } });
  expect(screen.getByText(/shows that year's luck/)).toBeTruthy();

  // Nothing invested.
  fireEvent.change(screen.getByLabelText("Initial amount"), { target: { value: "0" } });
  expect(screen.getByText("Enter an initial amount or a yearly contribution above zero.")).toBeTruthy();

  // Real values change the label to the start year's dollars.
  fireEvent.change(screen.getByLabelText("Initial amount"), { target: { value: "10000" } });
  fireEvent.click(screen.getByLabelText("Adjust for inflation (real value)"));
  expect(screen.getByText("Final value (in 2000 US dollars)")).toBeTruthy();

  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "sp500_history",
    page_type: "tools/sp500-historical-returns-calculator",
  });
});

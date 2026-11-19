// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { computeAllowance, ALLOWANCE_EXAMPLE } from "@/lib/calculators/allowance";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-christmas-allowance-calculator",
}));

const { default: AllowanceCalculatorComp } = await import("./AllowanceCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

const euros = (cents: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);

it("shows the example net, validates edge cases, and tracks one edit with metadata only", () => {
  const example = computeAllowance(ALLOWANCE_EXAMPLE);
  if (!example.ok) throw new Error("example");
  render(<AllowanceCalculatorComp locale="en" kind="christmas" />);
  expect(screen.getByText(euros(example.result.total.netCents))).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const gross = screen.getByRole("spinbutton", { name: "Gross monthly salary" });
  fireEvent.change(gross, { target: { value: "" } });
  expect(gross.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText(euros(example.result.total.netCents))).toBeNull();
  fireEvent.change(gross, { target: { value: "0" } });
  expect(screen.getByText("Enter a positive number.")).toBeTruthy();
  fireEvent.change(gross, { target: { value: "1000000" } });
  expect(screen.getByText(/Enter a value up to/)).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(gross, { target: { value: "1500" } });
  const start = screen.getByLabelText("Start date (optional)");
  fireEvent.change(start, { target: { value: "2027-03-01" } });
  expect(screen.getByText(/covers 2026/)).toBeTruthy();
  fireEvent.change(start, { target: { value: "2026-07-01" } });
  fireEvent.change(screen.getByLabelText("How the allowance is paid"), { target: { value: "twelfths" } });
  expect(screen.getByText("Extra net amount in each monthly salary")).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "christmas_allowance", page_type: "tools/portugal-christmas-allowance-calculator",
  });
});

it("explains the hiring-year holiday rule and a start date with no complete month", () => {
  render(<AllowanceCalculatorComp locale="en" kind="holiday" />);
  fireEvent.change(screen.getByLabelText("Start date (optional)"), { target: { value: "2026-12-10" } });
  expect(screen.getByText(/no holiday allowance to pay/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Start date (optional)"), { target: { value: "2026-03-15" } });
  expect(screen.getByText(/Holiday days counted: 18 of 22/)).toBeTruthy();
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { STATE_PENSION_EXAMPLE, computeStatePension } from "@/lib/calculators/statePension";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-state-pension-calculator",
}));

const { default: StatePensionCalculatorComp } = await import("./StatePensionCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, explains edge cases and tracks one edit with metadata only", () => {
  const outcome = computeStatePension(STATE_PENSION_EXAMPLE);
  if (!outcome.ok) throw new Error("example must be valid");
  const euros = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);

  render(<StatePensionCalculatorComp locale="en" />);
  expect(document.getElementById("state-pension-monthly")?.textContent).toBe(euros(outcome.result.monthlyCents));
  expect(screen.getAllByText(/rough estimate/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Open the official simulator" }).getAttribute("href")).toBe(
    "https://www.seg-social.pt/ptss/pssd/menu/simuladores/simulador-pensoes",
  );
  expect(screen.getByRole("link", { name: /FIRE calculator/ }).getAttribute("href")).toBe("/en/fire-calculator");
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const years = screen.getByRole("spinbutton", { name: "Years of contributions at retirement" });
  fireEvent.change(years, { target: { value: "10" } });
  expect(years.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(/needs at least 15 years of contributions/)).toBeTruthy();
  expect(document.getElementById("state-pension-monthly")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(years, { target: { value: "40" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Retirement age: years" }), { target: { value: "66" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Retirement age: extra months" }), { target: { value: "9" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Average gross monthly salary (today's euros)" }), {
    target: { value: "1500" },
  });
  expect(document.getElementById("state-pension-monthly")?.textContent).toBe("€1,353.30");
  expect(screen.getByText(/no penalty and no bonus/)).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "state_pension", page_type: "tools/portugal-state-pension-calculator",
  });
});

it("shows the net pension after IRS next to the net pay", () => {
  const outcome = computeStatePension(STATE_PENSION_EXAMPLE);
  if (!outcome.ok) throw new Error("example must be valid");
  render(<StatePensionCalculatorComp locale="en" />);
  expect(screen.getByText("Estimated net pension (per payment, after IRS)")).toBeTruthy();
  expect(outcome.result.netPensionCents).toBeLessThan(outcome.result.monthlyCents);
  expect(outcome.result.pensionWithholdingCents).toBeGreaterThan(0);
});

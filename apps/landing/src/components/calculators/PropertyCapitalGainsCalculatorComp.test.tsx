// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CAPITAL_GAINS_EXAMPLE, computeCapitalGains } from "@/lib/calculators/propertyCapitalGains";
import { formatMoney } from "@/lib/numberFormat";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-property-capital-gains-calculator",
}));

const { default: PropertyCapitalGainsCalculatorComp } = await import("./PropertyCapitalGainsCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

const example = computeCapitalGains(CAPITAL_GAINS_EXAMPLE);
if (!example.ok) throw new Error("example");
const money = (value: number) => formatMoney("en", value, { decimals: 2 });

it("shows the example, validates, shows the checklist and tracks one edit with metadata only", () => {
  render(<PropertyCapitalGainsCalculatorComp locale="en" />);
  expect(screen.getByText(money(example.result.extraTax), { selector: "#capitalGains-extraTax" })).toBeTruthy();
  expect(screen.queryByText("Conditions to check for the reinvestment exclusion")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const sale = screen.getByRole("spinbutton", { name: "Sale value" });
  fireEvent.change(sale, { target: { value: "" } });
  expect(sale.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText(money(example.result.extraTax), { selector: "#capitalGains-extraTax" })).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(sale, { target: { value: "100000" } });
  expect(screen.getByText("The sale ended in a loss, so no gain is added to your income.")).toBeTruthy();
  expect(screen.getByText("€0.00", { selector: "#capitalGains-extraTax" })).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: /permanent home/ }));
  expect(screen.getByText("Conditions to check for the reinvestment exclusion")).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "property_capital_gains", page_type: "tools/portugal-property-capital-gains-calculator",
  });
});

it("uses the tax value (VPT) for the gain when it is above the price (art. 44(2) CIRS)", () => {
  render(<PropertyCapitalGainsCalculatorComp locale="en" />);
  const vpt = screen.getByRole("spinbutton", { name: /Tax value \(VPT\)/ });
  expect((vpt as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("Sale value used for the gain")).toBeNull();

  fireEvent.change(vpt, { target: { value: "350000" } });
  const withVpt = computeCapitalGains({ ...CAPITAL_GAINS_EXAMPLE, taxValue: 350_000 });
  if (!withVpt.ok) throw new Error("vpt");
  expect(screen.getByText(money(withVpt.result.extraTax), { selector: "#capitalGains-extraTax" })).toBeTruthy();
  expect(screen.getByText("Sale value used for the gain")).toBeTruthy();
  expect(screen.getByText(/higher than the price, so the gain is calculated on it/)).toBeTruthy();

  fireEvent.change(vpt, { target: { value: "200000" } });
  expect(screen.getByText(money(example.result.extraTax), { selector: "#capitalGains-extraTax" })).toBeTruthy();
  expect(screen.queryByText("Sale value used for the gain")).toBeNull();
});

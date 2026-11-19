// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/property-purchase-taxes-calculator",
}));

const { default: PurchaseTaxesCalculatorComp } = await import("./PurchaseTaxesCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the total, keeps the young exemption as a separate toggle and tracks metadata only", () => {
  render(<PurchaseTaxesCalculatorComp locale="en" />);
  expect(screen.getByText("€10,242.04")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const price = screen.getByRole("spinbutton", { name: /Purchase price/ });
  fireEvent.change(price, { target: { value: "" } });
  expect(price.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText("€10,242.04")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(price, { target: { value: "200000" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Mortgage amount/ }), { target: { value: "0" } });
  expect(screen.getByText("€5,142.04")).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("€0.00", { selector: "#purchaseTaxes-total" })).toBeTruthy();

  fireEvent.click(screen.getByRole("radio", { name: "Secondary home or other housing" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "purchase_taxes", page_type: "tools/property-purchase-taxes-calculator",
  });
});

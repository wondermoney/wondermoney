// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: vi.fn(),
  getPageType: () => "tools/portugal-vehicle-tax-calculator",
}));

const { default: VehicleTaxCalculatorComp } = await import("./VehicleTaxCalculatorComp");

afterEach(cleanup);

const scheduleMonths = (title: string) => {
  const list = screen.getByText(title).nextElementSibling as HTMLElement;
  return Array.from(list.querySelectorAll("li > span:first-child")).map((node) => node.textContent);
};

it("computes the 2028 instalment months on the total across vehicles while the car's own tax stays the same", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  const annual = document.getElementById("vehicleTax-annualTax")?.textContent;
  expect(scheduleMonths("From 2028: payment schedule")).toEqual(["April", "October"]);
  expect(scheduleMonths("2027 (transitional): payment schedule")).toEqual(["October"]);

  fireEvent.change(screen.getByRole("spinbutton", { name: /Other IUC you pay this year/ }), { target: { value: "400" } });
  expect(document.getElementById("vehicleTax-annualTax")?.textContent).toBe(annual);
  expect(scheduleMonths("From 2028: payment schedule")).toEqual(["April", "July", "October"]);
  expect(scheduleMonths("2027 (transitional): payment schedule")).toEqual(["July", "October"]);
  expect(screen.getByText(/the amounts are this car's share of each instalment/)).toBeTruthy();
});

it("flags a negative other IUC amount", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  const field = screen.getByRole("spinbutton", { name: /Other IUC you pay this year/ });
  fireEvent.change(field, { target: { value: "-5" } });
  expect(field.getAttribute("aria-invalid")).toBe("true");
});

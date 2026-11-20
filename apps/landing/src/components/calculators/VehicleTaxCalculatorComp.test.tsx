// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const groups = () => screen.queryAllByRole("group");
const annualTax = () => document.getElementById("vehicleTax-annualTax")?.textContent;
const addVehicle = () => fireEvent.click(screen.getByRole("button", { name: "Add another vehicle" }));
const listItems = (title: string) => {
  const list = screen.getByText(title).nextElementSibling as HTMLElement;
  return Array.from(list.querySelectorAll("li")).map((item) => item.textContent);
};

it("starts with one car and no name or remove controls, as before", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  expect(groups()).toHaveLength(1);
  expect(screen.queryByRole("textbox", { name: "Name (optional)" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  expect(screen.getByText("Estimated annual IUC")).toBeTruthy();
  expect(annualTax()).toBe("€158.29");
  expect(screen.getByText("Year coefficient")).toBeTruthy();
  expect(screen.getByText(/In March, the month of your registration anniversary/)).toBeTruthy();
});

it("adds a vehicle, moves focus to it and shows each car's IUC, the total and the grouped months", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  addVehicle();
  expect(groups().map((group) => group.querySelector("legend")?.textContent)).toEqual(["Car 1", "Car 2"]);
  const second = screen.getByRole("group", { name: "Car 2" });
  expect(document.activeElement).toBe(within(second).getByRole("textbox", { name: "Name (optional)" }));

  // Car 2: category A petrol, 1200 cm3, March 2000 (39.95). Car 1 stays the 158.29 example.
  fireEvent.change(within(second).getByRole("combobox", { name: "Fuel" }), { target: { value: "petrol" } });
  fireEvent.change(within(second).getByRole("spinbutton", { name: "Engine size" }), { target: { value: "1200" } });
  fireEvent.change(within(second).getByRole("spinbutton", { name: "Year of first registration" }), { target: { value: "2000" } });
  fireEvent.change(within(second).getByRole("textbox", { name: "Name (optional)" }), { target: { value: "Old Fiat" } });
  expect(screen.getByRole("group", { name: "Old Fiat" })).toBe(second);
  expect(within(second).getByText("€39.95")).toBeTruthy();

  expect(screen.getByText("Estimated annual IUC, all vehicles")).toBeTruthy();
  expect(annualTax()).toBe("€198.24");
  expect(listItems("IUC per vehicle")).toEqual(["Car 1 (category B)€158.29", "Old Fiat (category A)€39.95"]);
  expect(listItems("2026: due in each car's registration anniversary month")).toEqual(["MarchCar 1 and Old Fiat€198.24"]);
  expect(listItems("2027 (transitional): payment schedule")).toEqual(["October€198.24"]);
  // 39.95 alone would be one April payment; the total of 198.24 splits it in two.
  expect(listItems("From 2028: payment schedule")).toEqual(["April€99.11", "October€99.13"]);
});

it("removes a vehicle, announces it and keeps the other labels", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  addVehicle();
  addVehicle();
  expect(annualTax()).toBe("€474.87");
  fireEvent.click(screen.getByRole("button", { name: "Remove Car 2" }));
  expect(groups().map((group) => group.querySelector("legend")?.textContent)).toEqual(["Car 1", "Car 3"]);
  expect(screen.getByRole("status").textContent).toBe("Car 2 removed.");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add another vehicle" }));
  expect(annualTax()).toBe("€316.58");
  // The freed number is reused for the next vehicle.
  addVehicle();
  expect(groups().map((group) => group.querySelector("legend")?.textContent)).toEqual(["Car 1", "Car 3", "Car 2"]);

  fireEvent.click(screen.getByRole("button", { name: "Remove Car 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Car 2" }));
  expect(groups()).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  expect(screen.getByText("Estimated annual IUC")).toBeTruthy();
  expect(annualTax()).toBe("€158.29");
});

it("stops at ten vehicles", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  for (let count = 1; count < 10; count += 1) addVehicle();
  expect(groups()).toHaveLength(10);
  expect(screen.queryByRole("button", { name: "Add another vehicle" })).toBeNull();
  expect(screen.getByText("You can add up to 10 vehicles.")).toBeTruthy();
});

it("hides the total while one car is invalid but still prices the others", () => {
  render(<VehicleTaxCalculatorComp locale="en" />);
  addVehicle();
  const second = screen.getByRole("group", { name: "Car 2" });
  fireEvent.change(within(second).getByRole("spinbutton", { name: "Engine size" }), { target: { value: "0" } });
  expect(annualTax()).toBeUndefined();
  expect(within(screen.getByRole("group", { name: "Car 1" })).getByText("€158.29")).toBeTruthy();
  expect(within(second).getByText("Check the highlighted fields to see your estimate.")).toBeTruthy();
});

it("labels the vehicles in pt-PT", () => {
  render(<VehicleTaxCalculatorComp locale="pt" />);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar outro veículo" }));
  expect(screen.getByRole("group", { name: "Carro 2" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remover Carro 2" })).toBeTruthy();
});

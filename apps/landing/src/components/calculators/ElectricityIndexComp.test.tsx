// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ELECTRICITY_BILL_EXAMPLE, computeElectricityBill } from "@/lib/calculators/electricityBill";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/electricity-price-index-portugal",
}));

const { default: ElectricityIndexComp } = await import("./ElectricityIndexComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

const eur = (value: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(value);

it("shows the worked example, the index with its date, edge cases and one metadata-only event", () => {
  const outcome = computeElectricityBill(ELECTRICITY_BILL_EXAMPLE);
  if (!outcome.ok) throw new Error("example must be valid");

  render(<ElectricityIndexComp locale="en" />);
  expect(screen.getAllByText(eur(outcome.result.total)).length).toBeGreaterThan(0);
  expect(screen.getByText(/Data as of 2026 S1/)).toBeTruthy();
  expect(screen.getByText(/ERSE's official price simulator/)).toBeTruthy();
  expect(screen.getByText(/names no supplier/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /official price simulator/ }).getAttribute("href")).toMatch(/^https:\/\/.*erse\.pt/);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  // At 3.45 kVA only the network-access part of the power term pays 6% VAT (Lista I, verba 2.33).
  const exampleTable = screen.getByRole("table", { name: /Bill breakdown/ });
  const networkRow = within(exampleTable).getByText(/network-access part \(3\.45 kVA/).closest("tr") as HTMLElement;
  expect(networkRow.textContent).toContain("6%");
  const restRow = within(exampleTable).getByText(/rest of the price \(3\.45 kVA/).closest("tr") as HTMLElement;
  expect(restRow.textContent).toContain("23%");

  // Bi-hourly asks for the off-peak share and compares with the simple tariff.
  fireEvent.change(screen.getByLabelText("Tariff option"), { target: { value: "biHourly" } });
  const share = screen.getByLabelText("Share of consumption in off-peak hours");
  expect(screen.getByText(/On the Simple option the same month would cost/)).toBeTruthy();

  // Out-of-range share: a clear message and no stale bill.
  fireEvent.change(share, { target: { value: "150" } });
  expect(screen.getByText("Enter a share from 0% to 100%.")).toBeTruthy();
  expect(share.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByRole("table", { name: /Bill breakdown/ })).toBeNull();
  fireEvent.change(share, { target: { value: "40" } });

  // The example month pays the audiovisual contribution.
  expect(within(exampleTable).getByText("Audiovisual contribution (CAV)")).toBeTruthy();

  // Zero consumption: only the fixed charges, and no CAV below 400 kWh a year.
  fireEvent.change(screen.getByLabelText("Electricity consumption"), { target: { value: "0" } });
  expect(screen.getByText("With no consumption the bill is only the fixed charges.")).toBeTruthy();
  const zeroTable = screen.getByRole("table", { name: /Bill breakdown/ });
  const cavRow = within(zeroTable).getByText("Audiovisual contribution (CAV), exempt below 400 kWh a year").closest("tr") as HTMLElement;
  expect(cavRow.textContent).toContain(eur(0));

  // Too much consumption.
  fireEvent.change(screen.getByLabelText("Electricity consumption"), { target: { value: "99999" } });
  expect(screen.getByText(/Enter 20,000 kWh or less/)).toBeTruthy();

  // A higher power pays the full VAT on its power term.
  fireEvent.change(screen.getByLabelText("Electricity consumption"), { target: { value: "300" } });
  fireEvent.change(screen.getByLabelText("Contracted power"), { target: { value: "6.9" } });
  const table = screen.getByRole("table", { name: /Bill breakdown/ });
  const powerRow = within(table).getByText(/Contracted power \(6\.90 kVA/).closest("tr") as HTMLElement;
  expect(powerRow.textContent).toContain("23%");

  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "electricity_index",
    page_type: "tools/electricity-price-index-portugal",
  });
});

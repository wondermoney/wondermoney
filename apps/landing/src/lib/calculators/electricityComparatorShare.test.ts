import { describe, expect, it } from "vitest";
import { readShareFragment, shareFragment, type SharedComparison } from "./electricityComparatorShare";
import { DEFAULT_OFFER_FILTERS } from "./electricityTariffComparator";

const STATE: SharedComparison = {
  mode: "quick",
  contractedPower: 6.9,
  option: "biHourly",
  cycle: "weekly",
  quickUnit: "bill",
  bill: 85,
  monthlyKwh: 200,
  source: "periods",
  period: "month",
  days: 30,
  total: 200,
  periods: [200, 130, 70],
  socialTariff: true,
  largeFamily: false,
  newClient: true,
  includeConditioned: false,
  includeRefunds: true,
  includeDual: false,
  cheapestPerSupplier: true,
  sortBy: "laterYears",
  filters: { ...DEFAULT_OFFER_FILTERS, pricing: "fixed", noLoyalty: true, supplier: "EDPC" },
  indexed: "market",
};

describe("comparator share link", () => {
  it("reads back what it wrote, in quick mode with the bill", () => {
    const read = readShareFragment(shareFragment(STATE));
    expect(read).toMatchObject({
      mode: "quick",
      contractedPower: 6.9,
      option: "biHourly",
      cycle: "weekly",
      quickUnit: "bill",
      bill: 85,
      socialTariff: true,
      newClient: true,
      includeConditioned: false,
      cheapestPerSupplier: true,
      sortBy: "laterYears",
      indexed: "market",
      filters: { pricing: "fixed", noLoyalty: true, supplier: "EDPC", allowDirectDebit: true },
    });
    // Quick mode with a bill carries neither the monthly kWh nor the full mode's fields.
    expect(read?.monthlyKwh).toBeUndefined();
    expect(read?.periods).toBeUndefined();
  });

  it("carries the full mode's kWh per period, and never the E-REDES file", () => {
    const full = { ...STATE, mode: "full" as const, source: "diagram" as const, period: "days" as const, days: 61, periods: [40, 100, 60] };
    const read = readShareFragment(shareFragment(full));
    expect(read).toMatchObject({ mode: "full", source: "periods", period: "days", days: 61, periods: [40, 100, 60] });
    expect(readShareFragment(shareFragment({ ...full, source: "total", total: 250 }))).toMatchObject({ source: "total", total: 250 });
  });

  it("ignores a plain anchor and leaves out values that are missing or out of range", () => {
    expect(readShareFragment("#guide")).toBeNull();
    expect(readShareFragment("")).toBeNull();
    const read = readShareFragment("#v=c1&kva=7&o=quad&bill=-5&kwh=abc&d=0.5&e=1_x&sup=<script>&price=cheap&socialTariff=yes");
    expect(read).toEqual({});
  });
});

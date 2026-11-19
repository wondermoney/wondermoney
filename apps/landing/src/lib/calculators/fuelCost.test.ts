import { describe, expect, it } from "vitest";
import {
  FUEL_COST_LIMITS,
  computeFuelCost,
  fuelCostExample,
  fuelPriceSeries,
  fuelPriceSummaries,
  latestFuelPrice,
  type FuelCostInput,
} from "./fuelCost";
import type { FuelPriceRow } from "./data/fuelPrices";

const base: FuelCostInput = { fuel: "diesel", distance: 1000, period: "month", tripsPerMonth: 20, consumption: 6, price: 2 };
const ok = (input: FuelCostInput) => {
  const outcome = computeFuelCost(input);
  if (!outcome.ok) throw new Error(`invalid: ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
};

describe("computeFuelCost", () => {
  it("costs distance times consumption times price", () => {
    expect(ok(base)).toMatchObject({ monthlyLitres: 60, monthly: 120, yearly: 1440, per100Km: 12, perKm: 0.12, litres: 60, cost: 120 });
  });

  it("turns a week into 52/12 weeks a month and a trip into trips a month", () => {
    const week = ok({ ...base, period: "week", distance: 300 });
    expect(week.monthlyKm).toBeCloseTo(1300, 6);
    expect(week.monthly).toBe(156);
    expect(week.cost).toBe(36);
    const trip = ok({ ...base, period: "trip", distance: 40, tripsPerMonth: 20 });
    expect(trip.monthlyKm).toBe(800);
    expect(trip.cost).toBe(4.8);
    expect(trip.monthly).toBe(96);
  });

  it("gives zero for no distance or no trips, which is not an error", () => {
    expect(ok({ ...base, distance: 0 }).monthly).toBe(0);
    expect(ok({ ...base, period: "trip", tripsPerMonth: 0 }).monthly).toBe(0);
  });

  it("rounds to the cent without drifting", () => {
    expect(ok({ ...base, distance: 33, consumption: 5.7, price: 1.879 }).monthly).toBe(3.53);
  });

  it("names every problem and never returns a result for bad input", () => {
    const outcome = computeFuelCost({ ...base, distance: NaN, consumption: 0, price: -1 });
    expect(outcome).toEqual({ ok: false, errors: { distance: "required", consumption: "zero", price: "negative" } });
    expect(computeFuelCost({ ...base, distance: FUEL_COST_LIMITS.distance + 1 })).toEqual({ ok: false, errors: { distance: "tooLarge" } });
    expect(computeFuelCost({ ...base, consumption: 41 })).toEqual({ ok: false, errors: { consumption: "tooLarge" } });
    expect(computeFuelCost({ ...base, price: 10.01 })).toEqual({ ok: false, errors: { price: "tooLarge" } });
    expect(computeFuelCost({ ...base, distance: -5 })).toEqual({ ok: false, errors: { distance: "negative" } });
    expect(computeFuelCost({ ...base, price: Infinity })).toEqual({ ok: false, errors: { price: "required" } });
  });

  it("checks trips a month only for trips", () => {
    expect(computeFuelCost({ ...base, tripsPerMonth: NaN }).ok).toBe(true);
    expect(computeFuelCost({ ...base, period: "trip", tripsPerMonth: 2.5 })).toEqual({ ok: false, errors: { tripsPerMonth: "notWhole" } });
    expect(computeFuelCost({ ...base, period: "trip", tripsPerMonth: 1001 })).toEqual({ ok: false, errors: { tripsPerMonth: "tooLarge" } });
  });

  it("starts the example at the latest diesel average", () => {
    const example = fuelCostExample();
    expect(example.price).toBe(latestFuelPrice("diesel"));
    expect(computeFuelCost(example).ok).toBe(true);
  });
});

describe("fuel price summaries", () => {
  const rows: FuelPriceRow[] = [
    ["2026-11-04", 2.0, 1.9, 1.0],
    ["2026-11-11", 2.1, 1.8, 1.0],
  ];

  it("compares the latest day with the one a week earlier", () => {
    const [diesel, petrol, lpg] = fuelPriceSummaries(rows);
    expect(diesel).toMatchObject({ fuel: "diesel", date: "2026-11-11", previousDate: "2026-11-04", price: 2.1, change: 0.1 });
    expect(diesel.changePercent).toBeCloseTo(5, 6);
    expect(petrol.change).toBe(-0.1);
    expect(lpg.change).toBe(0);
    expect(lpg.changePercent).toBe(0);
  });

  it("needs two weeks", () => {
    expect(() => fuelPriceSummaries(rows.slice(0, 1))).toThrow();
  });

  it("keeps the whole history for the chart", () => {
    expect(fuelPriceSeries(rows)).toEqual([
      { date: "2026-11-04", diesel: 2, gasoline95: 1.9, lpg: 1 },
      { date: "2026-11-11", diesel: 2.1, gasoline95: 1.8, lpg: 1 },
    ]);
  });
});

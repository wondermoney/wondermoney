import { describe, expect, it } from "vitest";
import {
  computeVehicleTax, computeVehicleTaxes, instalmentMonths, IUC_TABLES, transitionalMonths2027, VEHICLE_DETAILS_EXAMPLE,
  VEHICLE_TAX_EXAMPLE, VEHICLE_TAX_LIMITS, type VehicleDetails, type VehicleTaxInput,
} from "./vehicleTax";

function resultFor(overrides: Partial<VehicleTaxInput> = {}) {
  const calculation = computeVehicleTax({ ...VEHICLE_TAX_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

describe("annual vehicle tax (IUC)", () => {
  it("adds the cylinder and CO2 rates and applies the year coefficient (category B)", () => {
    expect(resultFor()).toEqual({
      category: "B", exempt: false, coefficient: 1.15, baseTax: 128.89, additionalTax: 0,
      dieselSurcharge: 10.07, annualTax: 158.29, totalAnnualTax: 158.29, monthlyProvision: 13.19, dueMonth: 3,
      schedule2027: [{ month: 10, amount: 158.29 }],
      schedule2028: [{ month: 4, amount: 79.14 }, { month: 10, amount: 79.15 }],
    });
  });

  it("adds no diesel surcharge for petrol and does not multiply it by the coefficient", () => {
    expect(resultFor({ fuel: "petrol" })).toMatchObject({ dieselSurcharge: 0, annualTax: 148.22 });
    // 1.15 applies to 128.89 only; the 10.07 surcharge is added as is.
    expect(resultFor({ fuel: "diesel", cc: 1598, co2: 120 }).annualTax).toBe(158.29);
    expect(resultFor({ fuel: "diesel", cc: 1250, co2: 120, year: 2007, month: 7 }).dieselSurcharge).toBe(5.02);
  });

  it("charges the additional rate above the WLTP or NEDC threshold for registrations after 2016", () => {
    expect(resultFor({ cc: 1999, co2: 230 })).toMatchObject({ additionalTax: 31.77, dieselSurcharge: 20.12, annualTax: 446.95 });
    expect(resultFor({ cc: 1999, co2: 205 }).additionalTax).toBe(0);
    expect(resultFor({ cc: 3000, co2: 270 })).toMatchObject({ additionalTax: 63.74, dieselSurcharge: 68.85, annualTax: 1061.1 });
    // NEDC thresholds are lower than WLTP.
    expect(resultFor({ cc: 1999, co2: 200, standard: "nedc" }).additionalTax).toBe(31.77);
    expect(resultFor({ cc: 1999, co2: 200, standard: "wltp" }).additionalTax).toBe(0);
    expect(resultFor({ cc: 1999, co2: 251, standard: "nedc" }).additionalTax).toBe(63.74);
  });

  it("does not charge the additional rate before 2017", () => {
    expect(resultFor({ cc: 1999, co2: 230, year: 2015 })).toMatchObject({ additionalTax: 0, annualTax: 410.42 });
  });

  it("uses coefficient 1.00 for July 2007 and 1.15 from 2010", () => {
    expect(resultFor({ fuel: "petrol", cc: 1250, co2: 120, year: 2007, month: 7 })).toMatchObject({
      category: "B", coefficient: 1, annualTax: 96.92, schedule2028: [{ month: 4, amount: 96.92 }],
    });
    expect(resultFor({ cc: 1250, co2: 120, year: 2008 }).coefficient).toBe(1.05);
    expect(resultFor({ cc: 1250, co2: 120, year: 2009 }).coefficient).toBe(1.1);
    expect(resultFor({ cc: 1250, co2: 120, year: 2010 }).coefficient).toBe(1.15);
  });

  it("uses the category A table by fuel, cylinder band and registration year", () => {
    expect(resultFor({ fuel: "petrol", cc: 1999, year: 2000, month: 5 })).toMatchObject({
      category: "A", annualTax: 158.31, dueMonth: 5,
    });
    expect(resultFor({ fuel: "diesel", cc: 1999, year: 1995, month: 5 })).toMatchObject({
      annualTax: 26, dieselSurcharge: 3.55,
    });
    expect(resultFor({ fuel: "petrol", cc: 1200, year: 1985, month: 5 }).annualTax).toBe(12.55);
    expect(resultFor({ fuel: "diesel", cc: 3001, year: 2006, month: 6 })).toMatchObject({
      annualTax: 183.32, dieselSurcharge: 25.01,
    });
    expect(resultFor({ fuel: "petrol", cc: 3501, year: 1990, month: 1 }).annualTax).toBe(263.11);
    // CO2 is not asked for category A, so a blank value is fine.
    expect(resultFor({ fuel: "petrol", cc: 1200, year: 2000, month: 6, co2: NaN }).category).toBe("A");
  });

  it("exempts electric cars in category B and ignores cc and CO2", () => {
    expect(resultFor({ fuel: "electric", cc: NaN, co2: NaN })).toMatchObject({
      exempt: true, annualTax: 0, monthlyProvision: 0, schedule2027: [], schedule2028: [],
    });
  });

  it("pays 2027 in October up to 500 euros and in July and October above (Decreto-Lei 161/2026, art. 6)", () => {
    expect(transitionalMonths2027(0)).toEqual([]);
    expect(transitionalMonths2027(100)).toEqual([10]);
    expect(transitionalMonths2027(500)).toEqual([10]);
    expect(transitionalMonths2027(500.01)).toEqual([7, 10]);
    const big = resultFor({ cc: 3000, co2: 270 });
    expect(big.schedule2027.map((row) => row.month)).toEqual([7, 10]);
    expect(big.schedule2027.reduce((sum, row) => Math.round(sum * 100 + row.amount * 100) / 100, 0)).toBe(1061.1);
  });

  it("splits the payment from 2028 by the 100 and 500 euro thresholds", () => {
    expect(instalmentMonths(0)).toEqual([]);
    expect(instalmentMonths(100)).toEqual([4]);
    expect(instalmentMonths(100.01)).toEqual([4, 10]);
    expect(instalmentMonths(500)).toEqual([4, 10]);
    expect(instalmentMonths(500.01)).toEqual([4, 7, 10]);
    const big = resultFor({ cc: 3000, co2: 270 });
    expect(big.schedule2028.map((row) => row.month)).toEqual([4, 7, 10]);
    expect(big.schedule2028.reduce((sum, row) => Math.round(sum * 100 + row.amount * 100) / 100, 0)).toBe(1061.1);
  });

  it("computes the instalment months on the taxpayer's total across all vehicles (Decreto-Lei 161/2026, arts. 6 and 17(3))", () => {
    const alone = resultFor(); // 158.29 euros
    const withOthers = resultFor({ otherIucEuros: 400 }); // total 558.29
    expect(withOthers.annualTax).toBe(alone.annualTax);
    expect(withOthers.monthlyProvision).toBe(alone.monthlyProvision);
    expect(withOthers.totalAnnualTax).toBe(558.29);
    expect(alone.totalAnnualTax).toBe(alone.annualTax);
    expect(alone.schedule2027.map((row) => row.month)).toEqual([10]);
    expect(withOthers.schedule2027.map((row) => row.month)).toEqual([7, 10]);
    expect(alone.schedule2028.map((row) => row.month)).toEqual([4, 10]);
    expect(withOthers.schedule2028.map((row) => row.month)).toEqual([4, 7, 10]);
    // The rows are this car's share, so they still add up to its own tax.
    const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((total, row) => total + row.amount * 100, 0)) / 100;
    expect(sum(withOthers.schedule2028)).toBe(158.29);
    expect(sum(withOthers.schedule2027)).toBe(158.29);
  });

  it("uses the 100 euro and 500 euro thresholds on the total, inclusively", () => {
    const cheap = resultFor({ fuel: "petrol", cc: 998, year: 1992, month: 1 }); // category A, 12.55 euros
    expect(cheap.annualTax).toBe(12.55);
    expect(cheap.schedule2028.map((row) => row.month)).toEqual([4]);
    expect(resultFor({ fuel: "petrol", cc: 998, year: 1992, month: 1, otherIucEuros: 87.45 }).schedule2028.map((r) => r.month)).toEqual([4]);
    expect(resultFor({ fuel: "petrol", cc: 998, year: 1992, month: 1, otherIucEuros: 87.46 }).schedule2028.map((r) => r.month)).toEqual([4, 10]);
    expect(resultFor({ fuel: "petrol", cc: 998, year: 1992, month: 1, otherIucEuros: 487.45 }).schedule2028.map((r) => r.month)).toEqual([4, 10]);
    expect(resultFor({ fuel: "petrol", cc: 998, year: 1992, month: 1, otherIucEuros: 487.46 }).schedule2028.map((r) => r.month)).toEqual([4, 7, 10]);
  });

  it("gives an exempt car no instalments whatever the other IUC", () => {
    const electric = resultFor({ fuel: "electric", year: 2022, otherIucEuros: 900 });
    expect(electric.schedule2027).toEqual([]);
    expect(electric.schedule2028).toEqual([]);
    expect(electric.totalAnnualTax).toBe(900);
  });

  it("validates the other IUC amount", () => {
    const errors = (otherIucEuros: number) => {
      const calculation = computeVehicleTax({ ...VEHICLE_TAX_EXAMPLE, otherIucEuros });
      return calculation.ok ? null : calculation.errors;
    };
    expect(errors(Number.NaN)).toEqual({ otherIucEuros: "required" });
    expect(errors(-1)).toEqual({ otherIucEuros: "negative" });
    expect(errors(VEHICLE_TAX_LIMITS.otherIuc + 1)).toEqual({ otherIucEuros: "tooLarge" });
    expect(errors(0)).toBeNull();
  });

  it("rejects empty, zero, negative and huge capacity and CO2 with clear codes", () => {
    const errors = (overrides: Partial<VehicleTaxInput>) => {
      const calculation = computeVehicleTax({ ...VEHICLE_TAX_EXAMPLE, ...overrides });
      return calculation.ok ? null : calculation.errors;
    };
    expect(errors({ cc: NaN, co2: NaN })).toEqual({ cc: "required", co2: "required" });
    expect(errors({ cc: 0, co2: 0 })).toEqual({ cc: "zero", co2: "zero" });
    expect(errors({ cc: -1 })).toEqual({ cc: "negative" });
    expect(errors({ cc: VEHICLE_TAX_LIMITS.cc + 1, co2: VEHICLE_TAX_LIMITS.co2 + 1 }))
      .toEqual({ cc: "tooLarge", co2: "tooLarge" });
    expect(errors({ cc: VEHICLE_TAX_LIMITS.cc, co2: VEHICLE_TAX_LIMITS.co2 })).toBeNull();
  });

  it("rejects unsupported registration dates and electric cars in category A", () => {
    const errors = (overrides: Partial<VehicleTaxInput>) => {
      const calculation = computeVehicleTax({ ...VEHICLE_TAX_EXAMPLE, ...overrides });
      return calculation.ok ? null : calculation.errors;
    };
    expect(errors({ year: 1980 })).toEqual({ year: "yearTooOld" });
    expect(errors({ year: 2027 })).toEqual({ year: "yearTooNew" });
    expect(errors({ year: NaN })).toEqual({ year: "required" });
    expect(errors({ month: 13 })).toEqual({ month: "month" });
    expect(errors({ fuel: "electric", year: 2005, month: 1 })).toEqual({ fuel: "electricCategoryA" });
  });
});

describe("diesel surcharge (adicional de IUC)", () => {
  it("uses tables I and II of art. 216 of Lei n.º 82-B/2014, in cents", () => {
    // Table I (category A): up to 1500, 1500-2000, 2000-3000, over 3000 cm3; after 1995, 1990-1995, 1981-1989.
    expect(IUC_TABLES.dieselSurcharge.categoryA.map((band) => band.cents)).toEqual([
      { recent: 314, mid: 198, old: 139 },
      { recent: 631, mid: 355, old: 198 },
      { recent: 986, mid: 551, old: 276 },
      { recent: 2501, mid: 1319, old: 570 },
    ]);
    expect(IUC_TABLES.dieselSurcharge.categoryA.map((band) => band.upTo)).toEqual([1500, 2000, 3000, Infinity]);
    // Table II (category B): up to 1250, 1250-1750, 1750-2500, over 2500 cm3.
    expect(IUC_TABLES.dieselSurcharge.categoryB).toEqual([
      { upTo: 1250, cents: 502 },
      { upTo: 1750, cents: 1007 },
      { upTo: 2500, cents: 2012 },
      { upTo: Infinity, cents: 6885 },
    ]);
  });

  it("cites art. 94 of the 2026 State Budget, which keeps the surcharge in force", () => {
    expect(IUC_TABLES.taxYear).toBe(2026);
    expect(IUC_TABLES.budgetSource).toBe("https://diariodarepublica.pt/dr/detalhe/lei/73-a-2025-993270096");
  });
});

describe("IUC across several vehicles of one taxpayer", () => {
  const details = (overrides: Partial<VehicleDetails> = {}): VehicleDetails => ({ ...VEHICLE_DETAILS_EXAMPLE, ...overrides });
  // 158.29 (diesel, March), 39.95 (category A petrol, March) and 426.83 (petrol with the additional rate, October).
  const family = [
    details(),
    details({ fuel: "petrol", cc: 1200, co2: NaN, year: 2000, month: 3 }),
    details({ fuel: "petrol", cc: 1999, co2: 230, year: 2021, month: 10 }),
  ];
  const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + Math.round(amount * 100), 0) / 100;

  it.each<[string, Partial<VehicleDetails>, number]>([
    ["the worked example", {}, 0],
    ["the worked example with other IUC", {}, 400],
    ["a category A diesel", { fuel: "diesel", cc: 1999, year: 1995, month: 5 }, 0],
    ["a cheap category A petrol at the 100 euro threshold", { fuel: "petrol", cc: 998, year: 1992, month: 1 }, 87.45],
    ["a cheap category A petrol over the threshold", { fuel: "petrol", cc: 998, year: 1992, month: 1 }, 87.46],
    ["a large category B car", { cc: 3000, co2: 270 }, 0],
    ["a 2007 NEDC car", { fuel: "petrol", cc: 1250, co2: 120, standard: "nedc", year: 2007, month: 7 }, 12.5],
    ["an electric car", { fuel: "electric", cc: NaN, co2: NaN, year: 2022 }, 900],
  ])("gives one vehicle exactly the single-car result: %s", (_, overrides, otherIucEuros) => {
    const vehicle = details(overrides);
    const { vehicles, summary } = computeVehicleTaxes([vehicle], otherIucEuros);
    const single = computeVehicleTax({ ...vehicle, otherIucEuros });
    expect(vehicles).toEqual([single]);
    if (!single.ok) throw new Error("expected a valid example");
    expect(summary).toMatchObject({
      annualTax: single.result.annualTax,
      totalAnnualTax: single.result.totalAnnualTax,
      monthlyProvision: single.result.monthlyProvision,
    });
    expect(summary?.schedule2028.map(({ month, amount }) => ({ month, amount }))).toEqual(single.result.schedule2028);
    expect(summary?.schedule2027.map(({ month, amount }) => ({ month, amount }))).toEqual(single.result.schedule2027);
  });

  it("starts from the worked example's car", () => {
    expect({ ...VEHICLE_DETAILS_EXAMPLE, otherIucEuros: 0 }).toEqual(VEHICLE_TAX_EXAMPLE);
  });

  it("keeps each car's own tax and makes the total the sum of the cars", () => {
    const { vehicles, summary } = computeVehicleTaxes(family, 0);
    const annual = vehicles.map((calculation) => (calculation.ok ? calculation.result.annualTax : NaN));
    expect(annual).toEqual([158.29, 39.95, 426.83]);
    family.forEach((vehicle, index) => {
      const alone = computeVehicleTax({ ...vehicle, otherIucEuros: 0 });
      expect(alone.ok && alone.result.annualTax).toBe(annual[index]);
    });
    expect(summary?.annualTax).toBe(625.07);
    expect(summary?.annualTax).toBe(sum(annual));
    expect(summary?.totalAnnualTax).toBe(625.07);
    expect(summary?.monthlyProvision).toBe(52.09);
  });

  it("applies the instalment thresholds to the taxpayer's total, not to each car", () => {
    const { vehicles } = computeVehicleTaxes(family, 0);
    // 39.95 euros alone is one April payment; with the family's 625.07 it is split into three.
    const alone = computeVehicleTax({ ...family[1], otherIucEuros: 0 });
    expect(alone.ok && alone.result.schedule2028.map((row) => row.month)).toEqual([4]);
    for (const calculation of vehicles) {
      if (!calculation.ok) throw new Error("expected valid vehicles");
      expect(calculation.result.totalAnnualTax).toBe(625.07);
      expect(calculation.result.schedule2028.map((row) => row.month)).toEqual([4, 7, 10]);
      expect(calculation.result.schedule2027.map((row) => row.month)).toEqual([7, 10]);
    }
  });

  it("groups the payment months and adds up each month's amounts", () => {
    const { summary } = computeVehicleTaxes(family, 0);
    expect(summary?.due2026).toEqual([
      { month: 3, amount: 198.24, vehicles: [0, 1] },
      { month: 10, amount: 426.83, vehicles: [2] },
    ]);
    expect(summary?.schedule2027).toEqual([
      { month: 7, amount: 312.52, vehicles: [0, 1, 2] },
      { month: 10, amount: 312.55, vehicles: [0, 1, 2] },
    ]);
    expect(summary?.schedule2028).toEqual([
      { month: 4, amount: 208.34, vehicles: [0, 1, 2] },
      { month: 7, amount: 208.34, vehicles: [0, 1, 2] },
      { month: 10, amount: 208.39, vehicles: [0, 1, 2] },
    ]);
    for (const months of [summary!.due2026, summary!.schedule2027, summary!.schedule2028]) {
      expect(sum(months.map((row) => row.amount))).toBe(625.07);
    }
  });

  it("sorts the 2026 months through the year whatever the order of the cars", () => {
    const { summary } = computeVehicleTaxes([family[2], details({ month: 1 }), family[1]], 0);
    expect(summary?.due2026.map((row) => [row.month, row.vehicles])).toEqual([[1, [1]], [3, [2]], [10, [0]]]);
  });

  it("leaves exempt cars out of the payment months but keeps them in the list", () => {
    const electric = details({ fuel: "electric", cc: NaN, co2: NaN, year: 2022, month: 6 });
    const { vehicles, summary } = computeVehicleTaxes([family[1], electric], 0);
    expect(vehicles[1]).toMatchObject({ ok: true, result: { exempt: true, annualTax: 0, totalAnnualTax: 39.95 } });
    expect(summary?.due2026).toEqual([{ month: 3, amount: 39.95, vehicles: [0] }]);
    expect(summary?.schedule2028).toEqual([{ month: 4, amount: 39.95, vehicles: [0] }]);
  });

  it("adds the other IUC to the thresholds but schedules only the cars listed", () => {
    const { summary } = computeVehicleTaxes(family.slice(0, 2), 400); // 198.24 listed, 598.24 in all
    expect(summary).toMatchObject({ annualTax: 198.24, totalAnnualTax: 598.24 });
    expect(summary?.schedule2027.map((row) => row.month)).toEqual([7, 10]);
    expect(sum(summary!.schedule2028.map((row) => row.amount))).toBe(198.24);
    expect(summary?.schedule2028.map((row) => row.month)).toEqual([4, 7, 10]);
  });

  it("returns no summary while a car or the other IUC is invalid, and still prices the valid cars", () => {
    const withInvalid = computeVehicleTaxes([family[0], details({ cc: 0 })], 0);
    expect(withInvalid.summary).toBeNull();
    expect(withInvalid.vehicles[0]).toMatchObject({ ok: true, result: { annualTax: 158.29 } });
    expect(withInvalid.vehicles[1]).toEqual({ ok: false, errors: { cc: "zero" } });

    const badOther = computeVehicleTaxes(family, -1);
    expect(badOther.summary).toBeNull();
    expect(badOther.otherIucError).toBe("negative");
    // The per-car errors never carry the shared field.
    expect(badOther.vehicles.every((calculation) => calculation.ok)).toBe(true);
    expect(computeVehicleTaxes(family, Number.NaN).otherIucError).toBe("required");
    expect(computeVehicleTaxes([], 0).summary).toBeNull();
  });
});

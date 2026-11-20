import { describe, expect, it } from "vitest";
import {
  computeVehicleTax, instalmentMonths, IUC_TABLES, transitionalMonths2027, VEHICLE_TAX_EXAMPLE, VEHICLE_TAX_LIMITS,
  type VehicleTaxInput,
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

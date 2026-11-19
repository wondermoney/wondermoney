import { describe, expect, it } from "vitest";
import {
  computeVehicleTax, instalmentMonths, VEHICLE_TAX_EXAMPLE, VEHICLE_TAX_LIMITS, type VehicleTaxInput,
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
      annualTax: 148.22, monthlyProvision: 12.35, dueMonth: 3,
      schedule2027: [{ month: 4, amount: 74.11 }, { month: 10, amount: 74.11 }],
    });
  });

  it("charges the additional rate above the WLTP or NEDC threshold for registrations after 2016", () => {
    expect(resultFor({ cc: 1999, co2: 230 })).toMatchObject({ additionalTax: 31.77, annualTax: 426.83 });
    expect(resultFor({ cc: 1999, co2: 205 }).additionalTax).toBe(0);
    expect(resultFor({ cc: 3000, co2: 270 })).toMatchObject({ additionalTax: 63.74, annualTax: 992.25 });
    // NEDC thresholds are lower than WLTP.
    expect(resultFor({ cc: 1999, co2: 200, standard: "nedc" }).additionalTax).toBe(31.77);
    expect(resultFor({ cc: 1999, co2: 200, standard: "wltp" }).additionalTax).toBe(0);
    expect(resultFor({ cc: 1999, co2: 251, standard: "nedc" }).additionalTax).toBe(63.74);
  });

  it("does not charge the additional rate before 2017", () => {
    expect(resultFor({ cc: 1999, co2: 230, year: 2015 })).toMatchObject({ additionalTax: 0, annualTax: 390.3 });
  });

  it("uses coefficient 1.00 for July 2007 and 1.15 from 2010", () => {
    expect(resultFor({ cc: 1250, co2: 120, year: 2007, month: 7 })).toMatchObject({
      category: "B", coefficient: 1, annualTax: 96.92, schedule2027: [{ month: 4, amount: 96.92 }],
    });
    expect(resultFor({ cc: 1250, co2: 120, year: 2008 }).coefficient).toBe(1.05);
    expect(resultFor({ cc: 1250, co2: 120, year: 2009 }).coefficient).toBe(1.1);
    expect(resultFor({ cc: 1250, co2: 120, year: 2010 }).coefficient).toBe(1.15);
  });

  it("uses the category A table by fuel, cylinder band and registration year", () => {
    expect(resultFor({ fuel: "petrol", cc: 1999, year: 2000, month: 5 })).toMatchObject({
      category: "A", annualTax: 158.31, dueMonth: 5,
    });
    expect(resultFor({ fuel: "diesel", cc: 1999, year: 1995, month: 5 }).annualTax).toBe(22.45);
    expect(resultFor({ fuel: "petrol", cc: 1200, year: 1985, month: 5 }).annualTax).toBe(12.55);
    expect(resultFor({ fuel: "diesel", cc: 3001, year: 2006, month: 6 }).annualTax).toBe(158.31);
    expect(resultFor({ fuel: "petrol", cc: 3501, year: 1990, month: 1 }).annualTax).toBe(263.11);
    // CO2 is not asked for category A, so a blank value is fine.
    expect(resultFor({ fuel: "petrol", cc: 1200, year: 2000, month: 6, co2: NaN }).category).toBe("A");
  });

  it("exempts electric cars in category B and ignores cc and CO2", () => {
    expect(resultFor({ fuel: "electric", cc: NaN, co2: NaN })).toMatchObject({
      exempt: true, annualTax: 0, monthlyProvision: 0, schedule2027: [],
    });
  });

  it("splits the 2027 payment by the 100 and 500 euro thresholds", () => {
    expect(instalmentMonths(0)).toEqual([]);
    expect(instalmentMonths(100)).toEqual([4]);
    expect(instalmentMonths(100.01)).toEqual([4, 10]);
    expect(instalmentMonths(500)).toEqual([4, 10]);
    expect(instalmentMonths(500.01)).toEqual([4, 7, 10]);
    const big = resultFor({ cc: 3000, co2: 270 });
    expect(big.schedule2027.map((row) => row.month)).toEqual([4, 7, 10]);
    expect(big.schedule2027.reduce((sum, row) => Math.round(sum * 100 + row.amount * 100) / 100, 0)).toBe(992.25);
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

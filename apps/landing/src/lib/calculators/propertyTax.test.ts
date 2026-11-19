import { describe, expect, it } from "vitest";
import {
  computePropertyTax, instalmentCount, PROPERTY_TAX_EXAMPLE, PROPERTY_TAX_LIMITS,
  type PropertyTaxInput,
} from "./propertyTax";

function resultFor(overrides: Partial<PropertyTaxInput> = {}) {
  const calculation = computePropertyTax({ ...PROPERTY_TAX_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

describe("annual property tax (IMI)", () => {
  it("applies the municipal rate to the VPT, splits it in three and provisions a twelfth", () => {
    expect(resultFor()).toEqual({
      rate: 0.35, grossTax: 525, deduction: 0, annualTax: 525, monthlyProvision: 43.75,
      schedule: [
        { month: "may", amount: 175 },
        { month: "august", amount: 175 },
        { month: "november", amount: 175 },
      ],
    });
  });

  it("uses the 0.8% rustic rate and ignores the urban rate and dependants", () => {
    expect(resultFor({ kind: "rustic", vpt: 10_000, rate: NaN, dependants: 9 })).toMatchObject({
      rate: 0.8, annualTax: 80, deduction: 0, schedule: [{ month: "may", amount: 80 }],
    });
  });

  it("picks the instalment plan from the tax owed at the 2026 thresholds", () => {
    expect(instalmentCount(0)).toBe(0);
    expect(instalmentCount(100)).toBe(1);
    expect(instalmentCount(100.01)).toBe(2);
    expect(instalmentCount(500)).toBe(2);
    expect(instalmentCount(500.01)).toBe(3);
  });

  it("deducts the IMI Familiar amount before choosing instalments and never goes below zero", () => {
    expect(resultFor({ dependants: 1 })).toMatchObject({
      grossTax: 525, deduction: 30, annualTax: 495,
      schedule: [{ month: "may", amount: 247.5 }, { month: "november", amount: 247.5 }],
    });
    expect(resultFor({ dependants: 3 }).deduction).toBe(140);
    expect(resultFor({ vpt: 20_000, dependants: 3 })).toMatchObject({
      grossTax: 70, deduction: 70, annualTax: 0, monthlyProvision: 0, schedule: [],
    });
  });

  it("keeps cents exact and puts the rounding remainder in the last instalment", () => {
    const result = resultFor({ vpt: 123_456, rate: 0.303 });
    expect(result.annualTax).toBe(374.07);
    expect(result.schedule.reduce((sum, row) => Math.round(sum * 100 + row.amount * 100) / 100, 0))
      .toBe(374.07);
    expect(result.schedule.map((row) => row.amount)).toEqual([187.03, 187.04]);
  });

  it("handles a zero VPT", () => {
    expect(resultFor({ vpt: 0 })).toMatchObject({ annualTax: 0, monthlyProvision: 0, schedule: [] });
  });

  it("rejects blank, negative, oversized, out-of-range rate and bad dependants", () => {
    expect(computePropertyTax({ ...PROPERTY_TAX_EXAMPLE, vpt: NaN, rate: 0.29 })).toEqual({
      ok: false, errors: { vpt: "required", rate: "rateRange" },
    });
    expect(computePropertyTax({ ...PROPERTY_TAX_EXAMPLE, vpt: -1, rate: 0.46, dependants: 4 }))
      .toEqual({ ok: false, errors: { vpt: "negative", rate: "rateRange", dependants: "dependants" } });
    expect(computePropertyTax({ ...PROPERTY_TAX_EXAMPLE, vpt: PROPERTY_TAX_LIMITS.vpt + 1, rate: NaN }))
      .toEqual({ ok: false, errors: { vpt: "tooLarge", rate: "required" } });
    expect(resultFor({ rate: 0.3 }).annualTax).toBe(450);
    expect(resultFor({ rate: 0.45 }).annualTax).toBe(675);
  });
});

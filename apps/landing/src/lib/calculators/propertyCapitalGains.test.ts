import { describe, expect, it } from "vitest";
import { annualBracketTaxCents } from "./payroll";
import {
  CAPITAL_GAINS_EXAMPLE, CAPITAL_GAINS_LIMITS, CAPITAL_GAINS_TABLES, computeCapitalGains, type CapitalGainsInput,
} from "./propertyCapitalGains";

function resultFor(overrides: Partial<CapitalGainsInput> = {}) {
  const calculation = computeCapitalGains({ ...CAPITAL_GAINS_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}
const errorsFor = (overrides: Partial<CapitalGainsInput>) => {
  const calculation = computeCapitalGains({ ...CAPITAL_GAINS_EXAMPLE, ...overrides });
  return calculation.ok ? {} : calculation.errors;
};

describe("property capital gains", () => {
  it("updates the purchase value by the coefficient and deducts expenses (worked example)", () => {
    // 150,000 x 1.23 = 184,500; expenses 6,000 + 10,000 + 9,000; gain 300,000 - 184,500 - 25,000.
    const r = resultFor();
    expect(r).toMatchObject({
      coefficientApplied: true, coefficient: 1.23, adjustedPurchase: 184_500, expenses: 25_000,
      gain: 90_500, taxableGain: 90_500, includedIncome: 45_250, exemptPercent: 0,
    });
    const extra = annualBracketTaxCents(7_525_000) - annualBracketTaxCents(3_000_000);
    expect(r.extraTax).toBe(extra / 100);
    expect(r.cashAfter).toBe(300_000 - 9_000 - extra / 100);
  });

  it("taxes only half of the gain at the marginal rate (hand-checked: 12.2% bracket)", () => {
    // Gain 10,000 with no other income: 5,000 included, all inside the first bracket.
    const r = resultFor({
      saleValue: 110_000, purchaseValue: 100_000, purchaseYear: 2025, purchaseMonth: 1, saleMonth: 12,
      purchaseExpenses: 0, worksExpenses: 0, saleExpenses: 0, otherIncome: 0,
    });
    expect(r).toMatchObject({ gain: 10_000, includedIncome: 5_000, extraTax: 610 });
  });

  it("applies the coefficient only after more than 24 months", () => {
    const base = { purchaseYear: 2024, purchaseMonth: 6 } as const;
    expect(resultFor({ ...base, saleMonth: 6 })).toMatchObject({ monthsHeld: 24, coefficientApplied: false, coefficient: 1 });
    expect(resultFor({ ...base, saleMonth: 7 })).toMatchObject({ monthsHeld: 25, coefficientApplied: true, coefficient: 1.02 });
  });

  it("stores the 2026 coefficients for every year from 1989", () => {
    const years = Object.keys(CAPITAL_GAINS_TABLES.coefficients).map(Number);
    expect(Math.min(...years)).toBe(1989);
    expect(Math.max(...years)).toBe(2025);
    expect(years).toHaveLength(2025 - 1989 + 1);
    expect(CAPITAL_GAINS_TABLES.coefficients[1989]).toBe(307);
    expect(CAPITAL_GAINS_TABLES.coefficients[2018]).toBe(120);
    expect(CAPITAL_GAINS_TABLES.coefficients[2014]).toBe(123);
  });

  it("excludes the whole gain when the net proceeds are reinvested, and part of it in proportion", () => {
    const full = resultFor({ ownPermanentHome: true, reinvested: 300_000 });
    expect(full).toMatchObject({ exemptPercent: 100, taxableGain: 0, includedIncome: 0, extraTax: 0 });
    // Net proceeds 300,000 - 100,000 loan = 200,000; reinvesting 100,000 excludes 50%.
    const part = resultFor({ ownPermanentHome: true, loanRepaid: 100_000, reinvested: 100_000 });
    expect(part).toMatchObject({ exemptPercent: 50, taxableGain: 45_250, includedIncome: 22_625 });
    expect(resultFor({ ownPermanentHome: true, reinvested: 0 })).toMatchObject({ exemptPercent: 0, taxableGain: 90_500 });
    // Reinvesting more than the proceeds never excludes more than 100%.
    expect(resultFor({ ownPermanentHome: true, reinvested: 900_000 }).exemptPercent).toBe(100);
  });

  it("ignores the reinvestment fields when the property is not the own permanent home", () => {
    expect(resultFor({ ownPermanentHome: false, reinvested: 300_000 }).exemptPercent).toBe(0);
    expect(errorsFor({ ownPermanentHome: false, reinvested: NaN })).toEqual({});
  });

  it("treats a loan repaid equal to the sale value as nothing left to reinvest", () => {
    expect(resultFor({ ownPermanentHome: true, loanRepaid: 300_000, reinvested: 0 }).exemptPercent).toBe(100);
    expect(errorsFor({ ownPermanentHome: true, loanRepaid: 300_001 }).loanRepaid).toBe("loanTooLarge");
  });

  it("reports a loss without tax and keeps the proceeds untaxed", () => {
    const r = resultFor({ saleValue: 120_000, purchaseValue: 150_000, purchaseYear: 2025, purchaseMonth: 1 });
    expect(r.isLoss).toBe(true);
    expect(r.gain).toBeLessThan(0);
    expect(r).toMatchObject({ taxableGain: 0, includedIncome: 0, extraTax: 0, cashAfter: 111_000 });
  });

  it("splits the extra income between spouses with joint taxation", () => {
    const single = resultFor({ otherIncome: 60_000 });
    const joint = resultFor({ otherIncome: 60_000, joint: true });
    const half = (v: number) => annualBracketTaxCents(v / 2);
    expect(joint.extraTax).toBe((2 * (half(6_000_000 + 4_525_000) - half(6_000_000))) / 100);
    expect(joint.extraTax).toBeLessThan(single.extraTax);
  });

  it("pays more tax on the same gain when other income is higher (marginal rates)", () => {
    expect(resultFor({ otherIncome: 150_000 }).extraTax).toBeGreaterThan(resultFor({ otherIncome: 0 }).extraTax);
  });

  it("handles a very large sale and a zero gain", () => {
    const large = resultFor({ saleValue: CAPITAL_GAINS_LIMITS.amount, purchaseValue: 1_000, otherIncome: 1_000_000 });
    expect(Number.isFinite(large.extraTax)).toBe(true);
    expect(large.extraTax).toBeGreaterThan(0);
    const zero = resultFor({
      saleValue: 100_000, purchaseValue: 100_000, purchaseYear: 2025, purchaseMonth: 1, saleMonth: 6,
      purchaseExpenses: 0, worksExpenses: 0, saleExpenses: 0,
    });
    expect(zero).toMatchObject({ gain: 0, isLoss: false, extraTax: 0 });
  });

  it("validates empty, zero, negative, huge and out-of-range values", () => {
    expect(errorsFor({ saleValue: NaN }).saleValue).toBe("required");
    expect(errorsFor({ saleValue: 0 }).saleValue).toBe("zero");
    expect(errorsFor({ purchaseValue: -1 }).purchaseValue).toBe("negative");
    expect(errorsFor({ saleValue: CAPITAL_GAINS_LIMITS.amount + 1 }).saleValue).toBe("tooLarge");
    expect(errorsFor({ otherIncome: NaN }).otherIncome).toBe("required");
    expect(errorsFor({ purchaseYear: 1988 }).purchaseYear).toBe("yearTooOld");
    expect(errorsFor({ purchaseYear: 2027 }).purchaseYear).toBe("yearTooNew");
    expect(errorsFor({ purchaseMonth: 13 }).purchaseMonth).toBe("month");
    expect(errorsFor({ purchaseYear: 2026, purchaseMonth: 8, saleMonth: 3 }).purchaseMonth).toBe("afterSale");
    expect(computeCapitalGains({ ...CAPITAL_GAINS_EXAMPLE, saleValue: NaN }).ok).toBe(false);
  });
});

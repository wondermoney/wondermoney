import { describe, expect, it } from "vitest";
import { SAVINGS_CERTIFICATES_BASE_RATE } from "./data/savingsCertificatesRate";
import {
  PERMANENCE_PREMIUM_STEPS,
  SAVINGS_CERTIFICATES_EXAMPLE,
  SAVINGS_CERTIFICATES_RULES,
  computeSavingsCertificates,
  permanencePremium,
} from "./savingsCertificates";

function run(amount: number, years: number, baseRate: number) {
  const calc = computeSavingsCertificates({ amount, years, baseRate });
  if (!calc.ok) throw new Error(JSON.stringify(calc.errors));
  return calc.result;
}

describe("permanence premium", () => {
  it("follows the Série F table year by year", () => {
    const expected = [0, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 1, 1, 1.5, 1.5, 1.75, 1.75];
    expected.forEach((premium, index) => expect(permanencePremium(index + 1)).toBe(premium));
    for (const step of PERMANENCE_PREMIUM_STEPS) {
      expect(permanencePremium(step.from)).toBe(step.premium);
      expect(permanencePremium(step.to)).toBe(step.premium);
    }
  });
});

describe("computeSavingsCertificates", () => {
  it("computes year one by hand: 10 000 at 2.5% base, no premium", () => {
    const r = run(10_000, 1, 2.5);
    // Quarter 1: 62.50 gross, 17.50 IRS, 45.00 net.
    expect(r.yearly[0].rate).toBe(2.5);
    // Quarters on 10 000.00, 10 045.00, 10 090.20 and 10 135.60 balances, by hand.
    expect(r.grossInterest).toBe(251.69);
    expect(r.irs).toBe(70.48);
    expect(r.finalValue).toBe(10_181.21);
    expect(r.irs / r.grossInterest).toBeCloseTo(0.28, 2);
    expect(r.finalValue).toBeCloseTo(10_000 + r.netInterest, 2);
    expect(r.premiumInterest).toBe(0);
  });

  it("first quarter is exactly rate/4, taxed at 28%", () => {
    const r = run(10_000, 1, 2);
    // Four compounding quarters at 0.5% gross, 0.36% net.
    let balance = 10_000;
    for (let i = 0; i < 4; i++) {
      const gross = Math.round(balance * 0.5) / 100;
      const tax = Math.round(gross * 28) / 100;
      balance = Math.round((balance + gross - tax) * 100) / 100;
    }
    expect(r.finalValue).toBeCloseTo(balance, 1);
  });

  it("adds premiums from year two and reports their share", () => {
    const withoutPremium = run(10_000, 1, 2.5).finalValue - 10_000;
    const r = run(10_000, 2, 2.5);
    expect(r.yearly[1].rate).toBe(2.75);
    expect(r.premiumInterest).toBeGreaterThan(0);
    expect(r.finalValue - 10_000).toBeGreaterThan(withoutPremium * 2);
  });

  it("balances: net interest is gross minus IRS and final value is invested plus net", () => {
    const r = run(25_000, 15, 1.2);
    expect(r.netInterest).toBeCloseTo(r.grossInterest - r.irs, 2);
    expect(r.finalValue).toBeCloseTo(r.invested + r.netInterest, 2);
    expect(r.yearly).toHaveLength(15);
    expect(r.yearly[14].rate).toBeCloseTo(1.2 + 1.75, 10);
  });

  it("pays no interest or tax at a 0% base before the premium", () => {
    const r = run(1_000, 1, 0);
    expect(r.grossInterest).toBe(0);
    expect(r.irs).toBe(0);
    expect(r.finalValue).toBe(1_000);
  });

  it("rejects inputs outside the rules", () => {
    const e = (amount: number, years: number, baseRate: number) => {
      const c = computeSavingsCertificates({ amount, years, baseRate });
      return c.ok ? null : c.errors;
    };
    expect(e(99, 5, 2)).toEqual({ amount: "tooSmall" });
    expect(e(250_001, 5, 2)).toEqual({ amount: "tooLarge" });
    expect(e(1000, 0, 2)).toEqual({ years: "years" });
    expect(e(1000, 16, 2)).toEqual({ years: "years" });
    expect(e(1000, 2.5, 2)).toEqual({ years: "years" });
    expect(e(1000, 5, 2.6)).toEqual({ baseRate: "baseRate" });
    expect(e(1000, 5, -1)).toEqual({ baseRate: "negative" });
    expect(e(NaN, NaN, NaN)).toEqual({ amount: "required", years: "required", baseRate: "required" });
  });

  it("defaults the base rate to the reference month within the 0% to 2.5% band", () => {
    const { referenceBaseRate, maxBaseRate } = SAVINGS_CERTIFICATES_RULES;
    // The monthly refresh moves the month on; it is never older than the November 2026 rate checked by hand.
    expect(referenceBaseRate.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    expect(referenceBaseRate.month >= "2026-11").toBe(true);
    expect(referenceBaseRate.rate).toBeGreaterThanOrEqual(0);
    expect(referenceBaseRate.rate).toBeLessThanOrEqual(maxBaseRate);
    expect(SAVINGS_CERTIFICATES_EXAMPLE.baseRate).toBe(referenceBaseRate.rate);
  });

  it("takes the default base rate and the rules from IGCP's own pages", () => {
    const { referenceBaseRate, rulesSource } = SAVINGS_CERTIFICATES_RULES;
    // IGCP's monthly notice gives the gross rate for new Série F subscriptions. A new subscription has no
    // permanence premium in year 1, so that is the base rate. scripts/build-savings-certificates-rate.mjs
    // writes it to data/savingsCertificatesRate.ts.
    expect(referenceBaseRate).toEqual({
      rate: SAVINGS_CERTIFICATES_BASE_RATE.rate,
      month: SAVINGS_CERTIFICATES_BASE_RATE.month,
      source: SAVINGS_CERTIFICATES_BASE_RATE.source,
    });
    expect(referenceBaseRate.source).toMatch(/^https:\/\/www\.igcp\.pt\/pt\/noticias\/taxas-de-juro-dos-certificados-de-aforro-/);
    expect(rulesSource).toBe(
      "https://www.igcp.pt/pt/aforristas/produtos-de-aforro/certificados-de-aforro/ficha-tecnica-certificados-de-aforro-serie-f",
    );
  });
});

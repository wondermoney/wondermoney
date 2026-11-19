import { describe, expect, it } from "vitest";
import { computeMortgage } from "./mortgage";
import { computePurchaseTaxes } from "./purchaseTaxes";
import {
  YOUTH_GUARANTEE,
  YOUTH_MORTGAGE_EXAMPLE,
  checkGuaranteeConditions,
  computeYouthMortgage,
} from "./youthMortgage";

const base = { price: 250_000, deposit: 0, annualRate: 3.5, termYears: 40 };

describe("youth mortgage estimate", () => {
  it("reuses the mortgage and purchase tax engines", () => {
    const calc = computeYouthMortgage(YOUTH_MORTGAGE_EXAMPLE);
    if (!calc.ok) throw new Error("expected ok");
    const mortgage = computeMortgage({ loanAmount: 250_000, termYears: 40, annualRate: 3.5, monthlyFees: 0 });
    if (!mortgage.ok) throw new Error("expected ok");
    expect(calc.result.monthlyPayment).toBe(mortgage.result.monthlyPayment);
    expect(calc.result.loan).toBe(250_000);
    expect(calc.result.ltv).toBe(100);
    const plain = computePurchaseTaxes({
      price: 250_000, taxValue: 0, loan: 250_000, region: "mainland", use: "ownPermanent", young: false,
    });
    if (!plain.ok) throw new Error("expected ok");
    expect(calc.result.taxesWithout).toBe(plain.result.total);
    // Full exemption up to the limit: only the 0.6% mortgage stamp duty (1,500) remains.
    expect(calc.result.taxesWithYoung).toBe(1_500);
    expect(calc.result.youngExemption).toBe("full");
    expect(calc.result.cashWithYoung).toBe(1_500);
    expect(calc.result.cashWithout).toBe(calc.result.taxesWithout);
  });

  it("adds the deposit to the cash needed and shrinks the loan", () => {
    const calc = computeYouthMortgage({ ...base, deposit: 25_000 });
    if (!calc.ok) throw new Error("expected ok");
    expect(calc.result.loan).toBe(225_000);
    expect(calc.result.ltv).toBe(90);
    expect(calc.result.cashWithYoung).toBe(25_000 + 1_350);
  });

  it("handles a deposit equal to the price as no mortgage", () => {
    const calc = computeYouthMortgage({ ...base, deposit: 250_000 });
    if (!calc.ok) throw new Error("expected ok");
    expect(calc.result.loan).toBe(0);
    expect(calc.result.monthlyPayment).toBe(0);
    expect(calc.result.ltv).toBe(0);
  });

  it("keeps the partial exemption above the full limit", () => {
    const calc = computeYouthMortgage({ ...base, price: 400_000 });
    if (!calc.ok) throw new Error("expected ok");
    expect(calc.result.youngExemption).toBe("partial");
    expect(calc.result.taxesWithYoung).toBeLessThan(calc.result.taxesWithout);
  });

  it("reports clear errors for the edge cases", () => {
    const errors = (input: Partial<typeof base>) => {
      const calc = computeYouthMortgage({ ...base, ...input });
      return calc.ok ? null : calc.errors;
    };
    expect(errors({ price: 0 })).toEqual({ price: "zero" });
    expect(errors({ price: NaN })).toEqual({ price: "required" });
    expect(errors({ deposit: 300_000 })).toEqual({ deposit: "depositTooLarge" });
    expect(errors({ deposit: -1 })).toEqual({ deposit: "negative" });
    expect(errors({ price: 1e12 })).toEqual({ price: "tooLarge" });
    expect(errors({ termYears: 41 })).toEqual({ termYears: "tooLarge" });
    expect(errors({ annualRate: -1 })).toEqual({ annualRate: "negative" });
    expect(errors({ price: 1_000, deposit: 950 })).toEqual({ deposit: "loanTooSmall" });
  });

  it("copes with very large values", () => {
    const calc = computeYouthMortgage({ ...base, price: 100_000_000 });
    expect(calc.ok).toBe(true);
  });
});

describe("guarantee checklist", () => {
  const ok = { age: 30, income: 40_000, ownPermanentHome: true, ownsOtherProperty: false, price: 300_000 };
  const status = (input: typeof ok, id: string) =>
    checkGuaranteeConditions(input).conditions.find((c) => c.id === id)?.status;

  it("marks every condition met without calling it eligibility", () => {
    const result = checkGuaranteeConditions(ok);
    expect(result.met).toBe(5);
    expect(result.notMet).toBe(0);
  });

  it("checks age inclusive of 18 and 35", () => {
    expect(status({ ...ok, age: 35 }, "age")).toBe("met");
    expect(status({ ...ok, age: 36 }, "age")).toBe("notMet");
    expect(status({ ...ok, age: 18 }, "age")).toBe("met");
    expect(status({ ...ok, age: 17 }, "age")).toBe("notMet");
    expect(status({ ...ok, age: NaN }, "age")).toBe("unknown");
  });

  it("checks price, income and property ownership", () => {
    expect(status({ ...ok, price: YOUTH_GUARANTEE.maxPrice }, "price")).toBe("met");
    expect(status({ ...ok, price: YOUTH_GUARANTEE.maxPrice + 1 }, "price")).toBe("notMet");
    expect(status({ ...ok, income: YOUTH_GUARANTEE.maxIncome + 1 }, "income")).toBe("notMet");
    expect(status({ ...ok, income: NaN }, "income")).toBe("unknown");
    expect(status({ ...ok, ownsOtherProperty: true }, "otherProperty")).toBe("notMet");
    expect(status({ ...ok, ownPermanentHome: false }, "ownHome")).toBe("notMet");
  });
});

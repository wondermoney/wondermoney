import { describe, expect, it } from "vitest";
import { CAR_LOAN_EXAMPLE, CAR_LOAN_LIMITS, computeCarLoan, type CarLoanInput } from "./carLoan";

function resultFor(overrides: Partial<CarLoanInput> = {}) {
  const calculation = computeCarLoan({ ...CAR_LOAN_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

describe("car loan and running costs", () => {
  it("combines fixed payments and running costs while keeping upfront fees out of the monthly budget", () => {
    const result = resultFor();
    expect(result).toMatchObject({
      financedAmount: 15_000,
      cashAtPurchase: 5_250,
      monthlyPayment: 294.99,
      monthlyFuel: 100,
      monthlyInsurance: 50,
      monthlyTax: 10,
      monthlyMaintenance: 40,
      monthlyRunning: 200,
      monthlyBudget: 494.99,
    });
    expect(result.financingCost).toBeCloseTo(2_949.52, 0);
    expect(result.purchaseWithFinancing).toBe(20_000 + result.financingCost);
    expect(result.apr).toBeCloseTo(7.71, 1);
    const noUpfrontFee = resultFor({ upfrontFees: 0 });
    expect(noUpfrontFee.monthlyBudget).toBe(result.monthlyBudget);
    expect(noUpfrontFee.apr).toBeLessThan(result.apr ?? 0);
  });

  it("divides a zero-interest balance by the term and gives 0% APR when there are no fees", () => {
    expect(resultFor({ annualRate: 0, upfrontFees: 0, monthlyFees: 0 })).toMatchObject({
      monthlyPayment: 250,
      financingCost: 0,
      apr: 0,
      monthlyBudget: 450,
    });
  });

  it("uses only running costs for cash purchases and already-owned cars", () => {
    expect(resultFor({
      deposit: 20_000, termMonths: NaN, annualRate: NaN, upfrontFees: 250, monthlyFees: 5,
    })).toMatchObject({
      financedAmount: 0,
      monthlyPayment: 0,
      cashAtPurchase: 20_000,
      monthlyBudget: 200,
      financingCost: 0,
      apr: null,
    });
    expect(resultFor({
      price: 0, deposit: 0, monthlyFuel: 0, annualInsurance: 0, annualMaintenance: 0, annualTax: 0,
    })).toMatchObject({ monthlyBudget: 0, cashAtPurchase: 0, apr: null });
  });

  it("averages each annual bill to the cent and leaves APR unavailable when fees consume the proceeds", () => {
    expect(resultFor({ upfrontFees: 15_000, annualInsurance: 100, annualTax: 20 })).toMatchObject({
      apr: null,
      monthlyInsurance: 8.33,
      monthlyTax: 1.67,
      monthlyRunning: 150,
      monthlyBudget: 444.99,
    });
  });

  it("rejects blank, negative, fractional-term and oversized inputs before amortization", () => {
    expect(computeCarLoan({
      ...CAR_LOAN_EXAMPLE,
      price: NaN,
      annualRate: NaN,
      monthlyFuel: -1,
      annualTax: Infinity,
      annualInsurance: NaN,
      termMonths: 12.5,
      upfrontFees: CAR_LOAN_LIMITS.upfrontFees + 1,
    })).toEqual({ ok: false, errors: {
      price: "required",
      annualRate: "required",
      monthlyFuel: "negative",
      annualTax: "tooLarge",
      annualInsurance: "required",
      termMonths: "term",
      upfrontFees: "tooLarge",
    } });
    expect(computeCarLoan({ ...CAR_LOAN_EXAMPLE, price: 0 }))
      .toEqual({ ok: false, errors: { deposit: "deposit" } });
  });
});

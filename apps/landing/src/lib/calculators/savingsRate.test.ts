import { describe, expect, it } from "vitest";
import { computeSavingsRate } from "./savingsRate";

describe("computeSavingsRate", () => {
  it("computes savings rate without deductions or duodecimos", () => {
    const result = computeSavingsRate({
      monthlyIncome: 3000,
      monthlyExpenses: 2000,
      monthlyDeductions: 0,
      includeDuodecimos: false,
      duodecimosAnnualAmount: 0,
    });

    expect(result.monthlySavings).toBe(1000);
    expect(result.savingsRate).toBe(33.3);
    expect(result.annualSavings).toBe(12000);
  });

  it("reduces effective income and savings when deductions are applied", () => {
    const result = computeSavingsRate({
      monthlyIncome: 3000,
      monthlyExpenses: 2000,
      monthlyDeductions: 300,
      includeDuodecimos: false,
      duodecimosAnnualAmount: 0,
    });

    expect(result.monthlySavings).toBe(700);
    expect(result.savingsRate).toBe(25.9);
    expect(result.annualSavings).toBe(8400);
  });

  it("adds monthly equivalent when duodecimos is enabled", () => {
    const result = computeSavingsRate({
      monthlyIncome: 3000,
      monthlyExpenses: 2000,
      monthlyDeductions: 300,
      includeDuodecimos: true,
      duodecimosAnnualAmount: 1200,
    });

    expect(result.monthlySavings).toBe(800);
    expect(result.savingsRate).toBe(28.6);
    expect(result.annualSavings).toBe(9600);
  });
});

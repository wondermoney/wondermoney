import { describe, expect, it } from "vitest";
import { computeCompoundInterest } from "./compoundInterest";

describe("computeCompoundInterest", () => {
  it("computes deterministic outputs for zero annual rate", () => {
    const result = computeCompoundInterest({
      principal: 10000,
      monthlyContribution: 200,
      annualRate: 0,
      years: 3,
    });

    expect(result.finalBalance).toBe(17200);
    expect(result.totalContributions).toBe(17200);
    expect(result.totalInterest).toBe(0);
    expect(result.chartData).toEqual([
      { year: 1, contributions: 12400, interest: 0 },
      { year: 2, contributions: 14800, interest: 0 },
      { year: 3, contributions: 17200, interest: 0 },
    ]);
  });

  it("computes deterministic outputs for positive annual rate", () => {
    const result = computeCompoundInterest({
      principal: 10000,
      monthlyContribution: 200,
      annualRate: 7,
      years: 3,
    });

    expect(result.finalBalance).toBe(20315);
    expect(result.totalContributions).toBe(17200);
    expect(result.totalInterest).toBe(3115);
    expect(result.chartData).toEqual([
      { year: 1, contributions: 12400, interest: 801 },
      { year: 2, contributions: 14800, interest: 1834 },
      { year: 3, contributions: 17200, interest: 3115 },
    ]);
  });
});

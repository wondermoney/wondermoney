import { describe, expect, it } from "vitest";
import {
  COMPARISON_FALLBACK,
  EXAMPLE_INPUTS,
  MAX_AMOUNT,
  MAX_RATE,
  MAX_RESULT,
  MAX_YEARS,
  compareContributions,
  computeCompoundInterest,
  defaultComparisonContribution,
  effectiveAnnualRate,
  type CompoundInterestParams,
} from "./compoundInterest";

const base: CompoundInterestParams = {
  principal: 10000,
  monthlyContribution: 200,
  annualRate: 7,
  inflationRate: 0,
  years: 3,
};

/** The nominal and real totals of a result that has them. */
function totals(params: CompoundInterestParams) {
  const result = computeCompoundInterest(params);
  if (result.status === "tooLarge") throw new Error("expected figures, got tooLarge");
  return result;
}

/** The textbook future value with monthly compounding and end-of-month contributions. */
function closedFormFutureValue(params: CompoundInterestParams): number {
  const r = params.annualRate / 100 / 12;
  const n = params.years * 12;
  const growth = (1 + r) ** n;
  return params.principal * growth + params.monthlyContribution * ((growth - 1) / r);
}

describe("computeCompoundInterest", () => {
  it("adds contributions without growth at a 0% return", () => {
    const result = totals({ ...base, annualRate: 0 });

    expect(result.status).toBe("ok");
    expect(result.nominal).toEqual({ contributed: 17200, growth: 0, finalValue: 17200 });
    expect(result.schedule).toEqual([
      { year: 0, contributed: 10000, growth: 0, value: 10000, realValue: 10000 },
      { year: 1, contributed: 12400, growth: 0, value: 12400, realValue: 12400 },
      { year: 2, contributed: 14800, growth: 0, value: 14800, realValue: 14800 },
      { year: 3, contributed: 17200, growth: 0, value: 17200, realValue: 17200 },
    ]);
  });

  it("compounds monthly with contributions at the end of each month", () => {
    const result = totals(base);

    expect(result.nominal).toEqual({ contributed: 17200, growth: 3115, finalValue: 20315 });
    expect(result.schedule.map((row) => row.growth)).toEqual([0, 801, 1834, 3115]);
    expect(Math.abs(result.nominal.finalValue - closedFormFutureValue(base))).toBeLessThan(1);
  });

  it("matches the closed-form future value over a long horizon", () => {
    const params = { ...base, principal: 25000, monthlyContribution: 350, annualRate: 5.5, years: 40 };
    const result = totals(params);

    // Interest is rounded to the cent each month, so the drift stays within a few euros.
    expect(Math.abs(result.nominal.finalValue - closedFormFutureValue(params))).toBeLessThan(5);
  });

  it("adds each contribution at month end, after that month's growth", () => {
    const params = { principal: 1000, monthlyContribution: 100, annualRate: 12, inflationRate: 0, years: 1 };
    const result = totals(params);

    // Month 1: 1000 + 1% (10.00) + 100 = 1110; the 100 earns nothing until month 2.
    expect(result.nominal.contributed).toBe(2200);
    // 1000 × 1.01^12 + 100 × (1.01^12 − 1) / 0.01 = 2395.08
    expect(result.nominal.finalValue).toBe(2395);
  });

  it("keeps contributed + growth = final value in every displayed figure", () => {
    const cases: CompoundInterestParams[] = [
      EXAMPLE_INPUTS,
      { principal: 0.4, monthlyContribution: 0.4, annualRate: 3.3, inflationRate: 2.7, years: 7 },
      { principal: 1234.56, monthlyContribution: 78.91, annualRate: 9.99, inflationRate: 1.5, years: 33 },
    ];

    for (const params of cases) {
      const result = totals(params);
      expect(result.nominal.contributed + result.nominal.growth).toBe(result.nominal.finalValue);
      expect(result.real.contributed + result.real.growth).toBe(result.real.finalValue);
      for (const row of result.schedule) {
        expect(row.contributed + row.growth).toBe(row.value);
        expect(Number.isInteger(row.value) && Number.isInteger(row.realValue)).toBe(true);
      }
    }
  });

  it("works the page's example: growth ends up larger than everything paid in", () => {
    const result = totals(EXAMPLE_INPUTS);

    expect(result.status).toBe("ok");
    expect(result.nominal).toEqual({ contributed: 58000, growth: 86573, finalValue: 144573 });
    expect(result.nominal.growth).toBeGreaterThan(result.nominal.contributed);
  });

  it("shows the final value in today's money by discounting at the inflation rate", () => {
    const result = totals(EXAMPLE_INPUTS);
    const yearsOfInflation = (1 + EXAMPLE_INPUTS.inflationRate / 100) ** EXAMPLE_INPUTS.years;

    expect(
      Math.abs(result.real.finalValue - result.nominal.finalValue / yearsOfInflation),
    ).toBeLessThanOrEqual(1);
    // Later contributions are worth less today, so less than the nominal sum went in.
    expect(result.real.contributed).toBeLessThan(result.nominal.contributed);
    expect(result.real.contributed).toBeGreaterThan(EXAMPLE_INPUTS.principal);
    expect(result.schedule.at(-1)?.realValue).toBe(result.real.finalValue);
    expect(result.inflationAtOrAboveReturn).toBe(false);
  });

  it("discounts each monthly contribution from the month it is paid", () => {
    // 1200 a month for one year at 0% return and 12.68% inflation: each payment
    // is worth 1200 / 1.0100^m today, with 1.0100 ≈ 1.1268^(1/12).
    const inflationRate = (1.01 ** 12 - 1) * 100;
    const result = totals({
      principal: 0,
      monthlyContribution: 1200,
      annualRate: 0,
      inflationRate,
      years: 1,
    });
    let expected = 0;
    for (let month = 1; month <= 12; month += 1) expected += 1200 / 1.01 ** month;

    expect(result.real.contributed).toBe(Math.round(expected));
    // The 14 400 paid in never grows, so it is worth less today than each payment was.
    expect(result.nominal.finalValue).toBe(14400);
    expect(result.real.finalValue).toBe(Math.round(14400 / 1.01 ** 12));
    expect(result.real.growth).toBe(result.real.finalValue - result.real.contributed);
    expect(result.real.growth).toBeLessThan(0);
  });

  it("shows a loss in today's money when inflation is above the return", () => {
    const result = totals({
      principal: 1000,
      monthlyContribution: 0,
      annualRate: 0,
      inflationRate: 2,
      years: 1,
    });

    expect(result.status).toBe("ok");
    expect(result.inflationAtOrAboveReturn).toBe(true);
    expect(result.nominal).toEqual({ contributed: 1000, growth: 0, finalValue: 1000 });
    expect(result.real).toEqual({ contributed: 1000, growth: -20, finalValue: 980 });
  });

  it("flags inflation at or above the return the money actually earns over a year", () => {
    const flag = (annualRate: number, inflationRate: number) =>
      computeCompoundInterest({ ...base, annualRate, inflationRate }).inflationAtOrAboveReturn;

    // 2% compounded monthly earns 2.018% over a year, so 2% inflation is below it…
    expect(flag(2, 2)).toBe(false);
    // …and 2.02% inflation is above it.
    expect(flag(2, 2.02)).toBe(true);
    expect(flag(2, 3)).toBe(true);
    expect(flag(0, 2)).toBe(true);
    expect(flag(2.5, 2)).toBe(false);
    expect(flag(0, 0)).toBe(false);
  });

  it("returns the starting amount for a period of 0 years", () => {
    const result = totals({ ...base, years: 0, inflationRate: 2 });

    expect(result.status).toBe("noPeriod");
    expect(result.nominal).toEqual({ contributed: 10000, growth: 0, finalValue: 10000 });
    expect(result.real).toEqual({ contributed: 10000, growth: 0, finalValue: 10000 });
    expect(result.schedule).toHaveLength(1);
  });

  it("reports nothing invested when both amounts are zero or empty", () => {
    for (const empty of [0, Number.NaN]) {
      const result = totals({ ...base, principal: empty, monthlyContribution: empty });
      expect(result.status).toBe("nothingInvested");
      expect(result.nominal).toEqual({ contributed: 0, growth: 0, finalValue: 0 });
      expect(result.adjusted).toBe(false);
    }
  });

  it("returns no period, not nothing invested, for 0 years with only a monthly contribution", () => {
    const result = totals({ ...base, principal: 0, years: 0 });

    expect(result.status).toBe("noPeriod");
    expect(result.nominal).toEqual({ contributed: 0, growth: 0, finalValue: 0 });
  });

  it("counts amounts that round to zero cents as nothing invested", () => {
    const result = totals({ ...base, principal: 0.004, monthlyContribution: 0.004 });

    expect(result.status).toBe("nothingInvested");
    expect(result.nominal).toEqual({ contributed: 0, growth: 0, finalValue: 0 });
  });

  it("treats negative inputs as zero and says so", () => {
    const result = computeCompoundInterest({
      principal: -5000,
      monthlyContribution: 100,
      annualRate: -3,
      inflationRate: -1,
      years: -2,
    });

    expect(result.adjusted).toBe(true);
    expect(result.inputs).toEqual({
      principal: 0,
      monthlyContribution: 100,
      annualRate: 0,
      inflationRate: 0,
      years: 0,
    });
    expect(result.status).toBe("noPeriod");
  });

  it("caps inputs above their range and says so", () => {
    const result = computeCompoundInterest({
      principal: MAX_AMOUNT * 2,
      monthlyContribution: 0,
      annualRate: MAX_RATE + 10,
      inflationRate: MAX_RATE + 10,
      years: MAX_YEARS + 10,
    });

    expect(result.adjusted).toBe(true);
    expect(result.inputs.principal).toBe(MAX_AMOUNT);
    expect(result.inputs.annualRate).toBe(MAX_RATE);
    expect(result.inputs.inflationRate).toBe(MAX_RATE);
    expect(result.inputs.years).toBe(MAX_YEARS);
  });

  it("uses whole years and does not flag rounding a fraction as an adjustment", () => {
    const result = computeCompoundInterest({ ...base, years: 2.6 });

    expect(result.inputs.years).toBe(3);
    expect(result.adjusted).toBe(false);
  });

  it("stops with a clear status instead of overflowing on huge results", () => {
    const result = computeCompoundInterest({
      principal: MAX_AMOUNT,
      monthlyContribution: MAX_AMOUNT,
      annualRate: MAX_RATE,
      inflationRate: 2,
      years: MAX_YEARS,
    });

    expect(result.status).toBe("tooLarge");
    expect(result.nominal).toBeNull();
    expect(result.real).toBeNull();
    expect(result.schedule).toEqual([]);
  });

  it("handles the largest result it accepts without losing cents", () => {
    // The maximum contributions at 0% stay under the result limit.
    const result = totals({
      principal: MAX_AMOUNT,
      monthlyContribution: MAX_AMOUNT,
      annualRate: 0,
      inflationRate: 0,
      years: MAX_YEARS,
    });

    expect(result.status).toBe("ok");
    expect(result.nominal.finalValue).toBe(MAX_AMOUNT * (1 + MAX_YEARS * 12));
    expect(result.nominal.finalValue).toBeLessThanOrEqual(MAX_RESULT);
  });
});

describe("effectiveAnnualRate", () => {
  it("gives the yearly growth of a rate compounded monthly", () => {
    expect(effectiveAnnualRate(0)).toBe(0);
    expect(effectiveAnnualRate(12)).toBeCloseTo(12.6825, 4);
  });
});

describe("defaultComparisonContribution", () => {
  it("is 50% more than the current contribution, rounded up to whole euros", () => {
    expect(defaultComparisonContribution(200)).toBe(300);
    expect(defaultComparisonContribution(125)).toBe(188);
    expect(defaultComparisonContribution(101)).toBe(152);
  });

  it("never starts below the current contribution", () => {
    for (const current of [0.01, 0.2, 0.5, 1, 1.3, 7.77]) {
      expect(defaultComparisonContribution(current)).toBeGreaterThan(current);
    }
    expect(defaultComparisonContribution(0.2)).toBe(1);
  });

  it("starts at the fallback amount when there is no current contribution", () => {
    expect(defaultComparisonContribution(0)).toBe(COMPARISON_FALLBACK);
    expect(defaultComparisonContribution(-50)).toBe(COMPARISON_FALLBACK);
    expect(defaultComparisonContribution(0.004)).toBe(COMPARISON_FALLBACK);
  });

  it("stays within the input range", () => {
    expect(defaultComparisonContribution(MAX_AMOUNT)).toBe(MAX_AMOUNT);
  });
});

describe("compareContributions", () => {
  it("compares the same plan at a second monthly contribution", () => {
    const comparison = compareContributions(base, 300);

    expect(comparison.current.inputs.monthlyContribution).toBe(200);
    expect(comparison.comparison.inputs.monthlyContribution).toBe(300);
    expect(comparison.difference).not.toBeNull();
    const { difference, current, comparison: other } = comparison;
    if (!difference || !current.nominal || !other.nominal || !current.real || !other.real) return;

    expect(difference.monthlyContribution).toBe(100);
    expect(difference.nominal.contributed).toBe(3600);
    expect(difference.nominal.finalValue).toBe(other.nominal.finalValue - current.nominal.finalValue);
    expect(difference.nominal.growth).toBe(other.nominal.growth - current.nominal.growth);
    expect(difference.real.finalValue).toBe(other.real.finalValue - current.real.finalValue);
    // The extra money earns growth too, so the final value rises by more than was paid in.
    expect(difference.nominal.finalValue).toBeGreaterThan(difference.nominal.contributed);
  });

  it("shows a negative difference when the second contribution is lower", () => {
    const { difference } = compareContributions(base, 100);

    expect(difference?.monthlyContribution).toBe(-100);
    expect(difference?.nominal.finalValue).toBeLessThan(0);
  });

  it("has no difference when either side is too large to show", () => {
    const huge = { ...base, principal: MAX_AMOUNT, annualRate: MAX_RATE, years: MAX_YEARS };

    expect(compareContributions(huge, 300).difference).toBeNull();
  });
});

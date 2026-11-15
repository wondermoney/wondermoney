import { describe, expect, it } from "vitest";
import {
  SAVINGS_GOAL_EXAMPLE,
  SAVINGS_GOAL_LIMITS,
  computeSavingsGoal,
  monthlyRateFor,
  type SavingsGoalInput,
  type SavingsGoalResult,
} from "./savingsGoal";

const base: SavingsGoalInput = { ...SAVINGS_GOAL_EXAMPLE };

function solve(overrides: Partial<SavingsGoalInput>): SavingsGoalResult {
  const calculation = computeSavingsGoal({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(`Unexpected errors: ${JSON.stringify(calculation.errors)}`);
  return calculation.result;
}

function errorsFor(overrides: Partial<SavingsGoalInput>) {
  const calculation = computeSavingsGoal({ ...base, ...overrides });
  if (calculation.ok) throw new Error("Expected input errors");
  return calculation.errors;
}

/** The balance a contribution reaches over the example's period, through the final-amount mode. */
function finalBalanceWith(overrides: Partial<SavingsGoalInput>): number {
  return solve({ ...overrides, solveFor: "finalAmount" }).finalBalance;
}

describe("monthlyRateFor", () => {
  it("is the monthly rate that compounds to the annual return over twelve months", () => {
    expect(monthlyRateFor(2) * 100).toBeCloseTo(0.16515813, 7);
    expect(Math.pow(1 + monthlyRateFor(2), 12)).toBeCloseTo(1.02, 12);
    expect(monthlyRateFor(0)).toBe(0);
  });

  it("grows a balance by the annual return in a year, to the cent", () => {
    const result = solve({
      solveFor: "finalAmount",
      startingSavings: 100_000,
      monthlyContribution: 0,
      years: 1,
      months: 0,
    });

    expect(result.finalBalance).toBe(102_000);
    expect(result.totalGrowth).toBe(2_000);
  });
});

describe("solving for the monthly contribution", () => {
  it("works the page's example: the contribution, what it adds up to and the growth", () => {
    const result = solve({});

    expect(result.status).toBe("solved");
    expect(result.monthlyContribution).toBe(241.2);
    expect(result.months).toBe(36);
    expect(result.totalContributions).toBe(8_683.2);
    expect(result.totalGrowth).toBe(316.96);
    expect(result.finalBalance).toBe(10_000.16);
  });

  it("rounds the contribution up to the cent so it actually reaches the goal", () => {
    const result = solve({});

    expect(finalBalanceWith({ monthlyContribution: result.monthlyContribution })).toBeGreaterThanOrEqual(10_000);
    expect(finalBalanceWith({ monthlyContribution: result.monthlyContribution - 0.01 })).toBeLessThan(10_000);
  });

  it("is the smallest reaching contribution over a range of goals, periods and returns", () => {
    for (const annualReturn of [0, 1.5, 4, 9.75, 30]) {
      for (const [years, months] of [[0, 1], [0, 7], [5, 0], [25, 6]]) {
        for (const goalAmount of [1, 999.99, 25_000, 3_000_000]) {
          const inputs = { annualReturn, years, months, goalAmount, startingSavings: 0.5 };
          const result = solve(inputs);
          if (result.status !== "solved") continue;

          const reached = finalBalanceWith({ ...inputs, monthlyContribution: result.monthlyContribution });
          const short = finalBalanceWith({
            ...inputs,
            monthlyContribution: Math.round(result.monthlyContribution * 100 - 1) / 100,
          });
          expect(reached).toBeGreaterThanOrEqual(goalAmount);
          expect(short).toBeLessThan(goalAmount);
        }
      }
    }
  });

  it("divides the gap evenly when the return is 0%, without dividing by zero", () => {
    expect(solve({ annualReturn: 0 }).monthlyContribution).toBe(250);
    expect(solve({ annualReturn: 0 }).totalGrowth).toBe(0);
    // 9000 / 35 = 257.142…, rounded up to the cent.
    expect(solve({ annualReturn: 0, years: 2, months: 11 }).monthlyContribution).toBe(257.15);
  });

  it("needs nothing a month when the savings already cover the goal", () => {
    const result = solve({ startingSavings: 12_000 });

    expect(result.status).toBe("reached");
    expect(result.monthlyContribution).toBe(0);
    expect(result.totalContributions).toBe(0);
  });

  it("needs nothing a month when growth alone reaches the goal in time", () => {
    const result = solve({ startingSavings: 9_500, annualReturn: 5 });

    expect(result.status).toBe("growthAlone");
    expect(result.monthlyContribution).toBe(0);
    expect(result.finalBalance).toBeGreaterThanOrEqual(10_000);
  });

  it("keeps the 0-a-month answer when the balance over the period is too large to show", () => {
    const longAndHigh = { years: 100, annualReturn: SAVINGS_GOAL_LIMITS.maxAnnualReturn };

    const reached = solve({ ...longAndHigh, goalAmount: 1_000, startingSavings: 2_000 });
    expect(reached.status).toBe("reached");
    expect(reached.monthlyContribution).toBe(0);
    expect(reached.balanceTooLarge).toBe(true);
    expect(reached.years).toEqual([]);

    const growthAlone = solve({ ...longAndHigh, goalAmount: 1_000, startingSavings: 500 });
    expect(growthAlone.status).toBe("growthAlone");
    expect(growthAlone.monthlyContribution).toBe(0);
    expect(growthAlone.balanceTooLarge).toBe(true);
  });

  it("asks for a goal and a period", () => {
    expect(errorsFor({ goalAmount: 0 })).toEqual({ goalAmount: "required" });
    expect(errorsFor({ goalAmount: Number.NaN })).toEqual({ goalAmount: "required" });
    expect(errorsFor({ years: 0, months: 0 })).toEqual({ period: "required" });
    expect(errorsFor({ years: Number.NaN, months: Number.NaN })).toEqual({ period: "required" });
  });

  it("ignores the contribution field, which is the answer", () => {
    expect(solve({ monthlyContribution: -5 }).monthlyContribution).toBe(241.2);
  });
});

describe("solving for the time", () => {
  const time = { solveFor: "time" } as const;

  it("counts the months to the goal, rounded up to a whole month", () => {
    const result = solve(time);

    expect(result.status).toBe("solved");
    expect(result.months).toBe(35);
    expect(result.finalBalance).toBeGreaterThanOrEqual(10_000);
    expect(result.totalContributions).toBe(8_750);
    // One month earlier the goal is not yet reached.
    expect(finalBalanceWith({ monthlyContribution: 250, years: 2, months: 10 })).toBeLessThan(10_000);
  });

  it("gives whole months at 0% return, without dividing by zero", () => {
    expect(solve({ ...time, annualReturn: 0 }).months).toBe(36);
    // 9000 / 700 = 12.86 contributions, so the goal is reached in the 13th month.
    expect(solve({ ...time, annualReturn: 0, monthlyContribution: 700 }).months).toBe(13);
  });

  it("is already there when the savings cover the goal", () => {
    const result = solve({ ...time, startingSavings: 10_000 });

    expect(result.status).toBe("reached");
    expect(result.months).toBe(0);
    expect(result.years).toEqual([]);
  });

  it("never reaches the goal with no contribution and nothing to grow", () => {
    expect(solve({ ...time, monthlyContribution: 0, annualReturn: 0 }).status).toBe("never");
    expect(solve({ ...time, monthlyContribution: 0, startingSavings: 0 }).status).toBe("never");
    expect(solve({ ...time, monthlyContribution: 0, startingSavings: 0 }).months).toBeNull();
  });

  it("can reach the goal on growth alone", () => {
    const result = solve({ ...time, monthlyContribution: 0, startingSavings: 5_000, annualReturn: 4 });

    expect(result.status).toBe("growthAlone");
    // 1.04^17 = 1.948 and 1.04^18 = 2.026: the goal is reached during the 18th year.
    expect(result.months).toBeGreaterThan(17 * 12);
    expect(result.months).toBeLessThanOrEqual(18 * 12);
  });

  it("stops at 100 years", () => {
    const result = solve({ ...time, monthlyContribution: 1, startingSavings: 0, annualReturn: 0 });

    expect(result.status).toBe("beyondHorizon");
    expect(result.months).toBeNull();
    // Exactly 100 years is still inside the horizon.
    expect(
      solve({ ...time, goalAmount: 1_200, monthlyContribution: 1, startingSavings: 0, annualReturn: 0 }).months,
    ).toBe(SAVINGS_GOAL_LIMITS.maxMonths);
  });

  it("ignores the period fields, which are the answer", () => {
    expect(solve({ ...time, years: -1, months: 5000 }).months).toBe(35);
  });
});

describe("solving for the final amount", () => {
  const final = { solveFor: "finalAmount" } as const;

  it("adds up the contributions and the growth over the period", () => {
    const result = solve(final);

    expect(result.status).toBe("solved");
    expect(result.balanceTooLarge).toBe(false);
    expect(result.finalBalance).toBe(10_326.29);
    expect(result.totalContributions).toBe(9_000);
    expect(result.totalGrowth).toBe(326.29);
  });

  it("is the savings plus the contributions at 0% return", () => {
    expect(solve({ ...final, annualReturn: 0 }).finalBalance).toBe(10_000);
  });

  it("does not need a goal", () => {
    expect(solve({ ...final, goalAmount: 0 }).finalBalance).toBe(10_326.29);
    expect(solve({ ...final, goalAmount: -1 }).goalAmount).toBe(0);
  });

  it("accepts nothing saved and nothing added", () => {
    const result = solve({ ...final, startingSavings: 0, monthlyContribution: 0 });

    expect(result.finalBalance).toBe(0);
    expect(result.totalGrowth).toBe(0);
  });

  it("reads empty optional fields as zero", () => {
    const result = solve({
      ...final,
      startingSavings: Number.NaN,
      monthlyContribution: Number.NaN,
      annualReturn: Number.NaN,
    });

    expect(result.finalBalance).toBe(0);
    expect(result.annualReturn).toBe(0);
  });

  it("reports a balance too large to show instead of a wrong figure", () => {
    const result = solve({
      ...final,
      startingSavings: SAVINGS_GOAL_LIMITS.maxAmount,
      monthlyContribution: SAVINGS_GOAL_LIMITS.maxAmount,
      years: 100,
      annualReturn: SAVINGS_GOAL_LIMITS.maxAnnualReturn,
    });

    expect(result.balanceTooLarge).toBe(true);
    expect(result.finalBalance).toBe(0);
    expect(result.years).toEqual([]);
  });
});

describe("the schedule", () => {
  it("has one row per year and a last row for a part year", () => {
    const result = solve({ solveFor: "finalAmount", years: 2, months: 6 });

    expect(result.years.map((row) => [row.year, row.month])).toEqual([
      [1, 12],
      [2, 24],
      [3, 30],
    ]);
  });

  it("adds up on every row and ends at the totals", () => {
    for (const solveFor of ["contribution", "time", "finalAmount"] as const) {
      const result = solve({ solveFor, annualReturn: 6.5, years: 7, months: 3 });
      const last = result.years.at(-1);

      for (const row of result.years) {
        expect(Math.round((result.startingSavings + row.contributions + row.growth) * 100)).toBe(
          Math.round(row.balance * 100),
        );
      }
      expect(last?.balance).toBe(result.finalBalance);
      expect(last?.contributions).toBe(result.totalContributions);
      expect(last?.growth).toBe(result.totalGrowth);
    }
  });

  it("ends in the month the goal is reached when solving for the time", () => {
    const result = solve({ solveFor: "time" });

    expect(result.years.at(-1)?.month).toBe(35);
    expect(result.years).toHaveLength(3);
  });
});

describe("input checks", () => {
  it("rejects negative amounts, periods and returns", () => {
    expect(errorsFor({ goalAmount: -1 })).toEqual({ goalAmount: "negative" });
    expect(errorsFor({ startingSavings: -1 })).toEqual({ startingSavings: "negative" });
    expect(errorsFor({ solveFor: "time", monthlyContribution: -1 })).toEqual({
      monthlyContribution: "negative",
    });
    expect(errorsFor({ years: -1 })).toEqual({ period: "negative" });
    expect(errorsFor({ months: -1 })).toEqual({ periodMonths: "negative" });
    expect(errorsFor({ annualReturn: -0.5 })).toEqual({ annualReturn: "negative" });
  });

  it("caps amounts, the period at 100 years and the return", () => {
    const tooMuch = SAVINGS_GOAL_LIMITS.maxAmount + 1;

    expect(errorsFor({ goalAmount: tooMuch })).toEqual({ goalAmount: "tooLarge" });
    expect(errorsFor({ goalAmount: Number.POSITIVE_INFINITY })).toEqual({ goalAmount: "tooLarge" });
    expect(errorsFor({ startingSavings: tooMuch })).toEqual({ startingSavings: "tooLarge" });
    expect(errorsFor({ solveFor: "finalAmount", monthlyContribution: tooMuch })).toEqual({
      monthlyContribution: "tooLarge",
    });
    expect(errorsFor({ years: 99, months: 12 })).toEqual({ periodMonths: "tooLarge" });
    expect(errorsFor({ years: 0, months: 12 })).toEqual({ periodMonths: "tooLarge" });
    expect(solve({ years: 0, months: 11 }).months).toBe(11);
    expect(errorsFor({ years: 100, months: 1 })).toEqual({ period: "tooLarge" });
    expect(solve({ years: 100, months: 0 }).months).toBe(1200);
    expect(errorsFor({ annualReturn: 30.01 })).toEqual({ annualReturn: "tooLarge" });
  });

  it("reports every invalid field at once", () => {
    expect(errorsFor({ goalAmount: 0, years: 0, annualReturn: -1 })).toEqual({
      goalAmount: "required",
      period: "required",
      annualReturn: "negative",
    });
  });

  it("allows a 0% return", () => {
    expect(computeSavingsGoal({ ...base, annualReturn: 0 }).ok).toBe(true);
  });
});

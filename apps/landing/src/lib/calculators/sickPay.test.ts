import { describe, expect, it } from "vitest";
import { MIN_DAILY_CENTS, SICK_PAY_EXAMPLE, computeSickPay, type SickPayInput } from "./sickPay";

function run(overrides: Partial<SickPayInput> = {}) {
  const outcome = computeSickPay({ ...SICK_PAY_EXAMPLE, ...overrides });
  if (!outcome.ok) throw new Error(`expected a valid input: ${JSON.stringify(outcome.errors)}`);
  return outcome.result;
}

describe("2026 values", () => {
  it("has a minimum of 9.20 a day, 30% of the minimum wage", () => {
    expect(MIN_DAILY_CENTS).toBe(920);
  });
});

describe("benefit by duration band", () => {
  it("pays 55% then 60% and leaves the 3 waiting days unpaid", () => {
    const result = run(); // 1500 a month: reference 50.00 a day
    expect(result.referenceDailyCents).toBe(5000);
    expect(result.waitingDays).toBe(3);
    expect(result.bands.map((band) => [band.percent, band.days, band.paidDays, band.dailyCents])).toEqual([
      [55, 30, 27, 2750],
      [60, 15, 15, 3000],
    ]);
    expect(result.totalCents).toBe(27 * 2750 + 15 * 3000);
  });

  it("reaches the 70% and 75% bands for long leaves", () => {
    const result = run({ sickDays: 400 });
    expect(result.bands.map((band) => [band.percent, band.days])).toEqual([[55, 30], [60, 60], [70, 275], [75, 35]]);
    expect(result.bands.reduce((sum, band) => sum + band.days, 0)).toBe(400);
  });

  it("pays from day 1 with a hospitalisation", () => {
    const result = run({ hospitalisation: true });
    expect(result.waitingDays).toBe(0);
    expect(result.bands[0].paidDays).toBe(30);
  });

  it("pays nothing when the whole leave is inside the waiting period", () => {
    const result = run({ sickDays: 3 });
    expect(result.totalCents).toBe(0);
    expect(result.paidDays).toBe(0);
    expect(result.waitingDays).toBe(3);
    expect(run({ sickDays: 1 }).waitingDays).toBe(1);
  });

  it("excludes the allowances when the salary is in twelfths", () => {
    expect(run({ grossMonthly: 1750, allowances: "twelfths" }).referenceDailyCents).toBe(5000);
  });
});

describe("limits and increase", () => {
  it("raises low reference pay to the 9.20 minimum", () => {
    const result = run({ grossMonthly: 600 }); // 20.00 a day, 55% = 11.00 > 9.20
    expect(result.bands[0].dailyCents).toBe(1100);
    const low = run({ grossMonthly: 420 }); // 14.00 a day, 55% = 7.70 -> 9.20
    expect(low.bands[0].dailyCents).toBe(920);
    expect(low.limit).toBe("minimum");
  });

  it("pays the reference pay itself when it is below the minimum", () => {
    const result = run({ grossMonthly: 240 }); // 8.00 a day
    expect(result.bands[0].dailyCents).toBe(800);
    expect(result.limit).toBe("referencePay");
  });

  it("adds 5 points on the 55% and 60% bands for a reference pay of 500 or less, whatever the household", () => {
    const result = run({ grossMonthly: 480, dependants: 0, sickDays: 100 }); // 16.00 a day, 480 a month
    expect(result.increaseApplied).toBe(true);
    expect(result.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
    expect(run({ grossMonthly: 500, dependants: 0 }).increaseApplied).toBe(true);
    expect(run({ grossMonthly: 500.01, dependants: 0 }).increaseApplied).toBe(false);
  });

  it("adds 5 points for 3 or more descendants, whatever the reference pay (art. 17 DL 28/2004: the conditions are alternatives)", () => {
    const result = run({ grossMonthly: 1500, dependants: 3, sickDays: 100 });
    expect(result.increaseApplied).toBe(true);
    expect(result.bands.map((band) => band.percent)).toEqual([60, 65, 70]);
    expect(run({ grossMonthly: 1500, dependants: 2 }).increaseApplied).toBe(false);
    expect(run({ grossMonthly: 600, dependants: 2 }).increaseApplied).toBe(false);
  });

  it("never pays more than the net reference pay", () => {
    const result = run({ grossMonthly: 30_000, sickDays: 500 });
    const last = result.bands.at(-1)!;
    // Reference pay is 1000.00 a day: 75% would be 750.00, the net cap is lower.
    expect(last.dailyCents).toBeLessThan(75_000);
    expect(result.limit).toBe("netCap");
  });
});

describe("income gap", () => {
  it("compares the benefit with normal net pay", () => {
    const result = run();
    expect(result.netMonthlyCents).toBeGreaterThan(result.firstMonthGapCents);
    expect(result.firstMonthGapCents).toBe(result.netMonthlyCents - 27 * 2750);
    expect(result.averageMonthlyGapCents).toBeGreaterThan(0);
  });

  it("is never negative", () => {
    expect(run({ grossMonthly: 240 }).averageMonthlyGapCents).toBeGreaterThanOrEqual(0);
  });
});

describe("validation", () => {
  it("rejects bad numbers with a field error", () => {
    const bad = computeSickPay({ ...SICK_PAY_EXAMPLE, sickDays: 0, grossMonthly: Number.NaN, dependants: 1.5 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toEqual({ sickDays: "tooSmall", grossMonthly: "required", dependants: "whole" });
    const tooLong = computeSickPay({ ...SICK_PAY_EXAMPLE, sickDays: 1096 });
    expect(tooLong.ok).toBe(false);
  });
});

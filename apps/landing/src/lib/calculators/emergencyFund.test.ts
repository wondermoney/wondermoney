import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTHS_OF_COVER,
  MAX_AMOUNT,
  MAX_MONTHS_OF_COVER,
  MAX_MONTHS_TO_TARGET,
  MIN_MONTHS_OF_COVER,
  computeEmergencyFund,
  targetMonthFrom,
} from "./emergencyFund";

const base = {
  monthlyExpenses: 1500,
  monthsOfCover: 6,
  currentSavings: 3000,
  monthlyContribution: 250,
};

describe("computeEmergencyFund", () => {
  it("works the page's example: target, shortfall and months to reach it", () => {
    const result = computeEmergencyFund(base);

    expect(result.status).toBe("onTrack");
    expect(result.target).toBe(9000);
    expect(result.shortfall).toBe(6000);
    expect(result.surplus).toBe(0);
    expect(result.monthsToTarget).toBe(24);
    expect(result.rangeLow).toBe(4500);
    expect(result.rangeHigh).toBe(9000);
    expect(result.capped).toBe(false);
  });

  it("rounds a partial last month up to a whole month", () => {
    const result = computeEmergencyFund({ ...base, monthlyContribution: 700 });

    // 6000 / 700 = 8.57 contributions, so the target is reached on the 9th.
    expect(result.monthsToTarget).toBe(9);
  });

  it("does not add a month when the contribution divides the shortfall exactly in cents", () => {
    // In floating point 0.1 × 3 is 0.30000000000000004, and that ÷ 0.1 rounds
    // up to 4 months. In cents it is 30 ÷ 10 = 3.
    const result = computeEmergencyFund({
      monthlyExpenses: 0.1,
      monthsOfCover: 3,
      currentSavings: 0,
      monthlyContribution: 0.1,
    });

    expect(result.target).toBe(0.3);
    expect(result.monthsToTarget).toBe(3);
  });

  it("reports a surplus and no months when savings already cover the target", () => {
    const result = computeEmergencyFund({ ...base, currentSavings: 10000 });

    expect(result.status).toBe("reached");
    expect(result.shortfall).toBe(0);
    expect(result.surplus).toBe(1000);
    expect(result.monthsToTarget).toBe(0);
  });

  it("treats savings exactly at the target as reached", () => {
    const result = computeEmergencyFund({ ...base, currentSavings: 9000 });

    expect(result.status).toBe("reached");
    expect(result.surplus).toBe(0);
    expect(result.monthsToTarget).toBe(0);
  });

  it("never reaches the target without a monthly contribution", () => {
    const result = computeEmergencyFund({ ...base, monthlyContribution: 0 });

    expect(result.status).toBe("noContribution");
    expect(result.shortfall).toBe(6000);
    expect(result.monthsToTarget).toBeNull();
  });

  it("asks for expenses when they are zero, whatever the savings", () => {
    const result = computeEmergencyFund({ ...base, monthlyExpenses: 0 });

    expect(result.status).toBe("noExpenses");
    expect(result.target).toBe(0);
    expect(result.shortfall).toBe(0);
    expect(result.surplus).toBe(0);
    expect(result.monthsToTarget).toBeNull();
  });

  it("treats negative, empty and non-numeric input as zero", () => {
    const result = computeEmergencyFund({
      monthlyExpenses: 1000,
      monthsOfCover: 3,
      currentSavings: -500,
      monthlyContribution: Number.NaN,
    });

    expect(result.target).toBe(3000);
    expect(result.shortfall).toBe(3000);
    expect(result.currentSavings).toBe(0);
    expect(result.monthlyContribution).toBe(0);
    expect(result.status).toBe("noContribution");
    expect(computeEmergencyFund({ ...base, monthlyExpenses: -10 }).status).toBe(
      "noExpenses",
    );
  });

  it("keeps months of cover between 1 and 24, in whole months", () => {
    expect(MIN_MONTHS_OF_COVER).toBe(1);
    expect(MAX_MONTHS_OF_COVER).toBe(24);
    expect(DEFAULT_MONTHS_OF_COVER).toBe(6);

    expect(computeEmergencyFund({ ...base, monthsOfCover: 0 }).monthsOfCover).toBe(1);
    expect(computeEmergencyFund({ ...base, monthsOfCover: 99 }).monthsOfCover).toBe(24);
    expect(computeEmergencyFund({ ...base, monthsOfCover: 6.6 }).monthsOfCover).toBe(7);
    expect(computeEmergencyFund({ ...base, monthsOfCover: Number.NaN }).monthsOfCover).toBe(
      DEFAULT_MONTHS_OF_COVER,
    );
    expect(computeEmergencyFund({ ...base, monthsOfCover: 99 }).target).toBe(36000);
  });

  it("caps very large amounts and says so, without losing precision", () => {
    const result = computeEmergencyFund({
      monthlyExpenses: 1e20,
      monthsOfCover: 24,
      currentSavings: 0,
      monthlyContribution: 1e20,
    });

    expect(result.capped).toBe(true);
    expect(result.target).toBe(MAX_AMOUNT * 24);
    expect(result.monthlyContribution).toBe(MAX_AMOUNT);
    expect(Number.isSafeInteger(result.target * 100)).toBe(true);
    expect(result.monthsToTarget).toBe(24);
  });

  it("flags a target further away than the horizon instead of giving a date", () => {
    const result = computeEmergencyFund({
      monthlyExpenses: 100000,
      monthsOfCover: 24,
      currentSavings: 0,
      monthlyContribution: 1,
    });

    expect(result.status).toBe("beyondHorizon");
    expect(result.monthsToTarget).toBeGreaterThan(MAX_MONTHS_TO_TARGET);
  });

  it("treats a horizon-length wait as still on track", () => {
    const result = computeEmergencyFund({
      monthlyExpenses: MAX_MONTHS_TO_TARGET,
      monthsOfCover: 1,
      currentSavings: 0,
      monthlyContribution: 1,
    });

    expect(result.status).toBe("onTrack");
    expect(result.monthsToTarget).toBe(MAX_MONTHS_TO_TARGET);
  });
});

describe("targetMonthFrom", () => {
  it("counts whole calendar months from the current month", () => {
    const target = targetMonthFrom(new Date(2026, 10, 15), 24);

    expect(target.toISOString()).toBe("2028-11-01T00:00:00.000Z");
  });

  it("rolls over the year and ignores the day of month", () => {
    expect(targetMonthFrom(new Date(2026, 0, 31), 1).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
    expect(targetMonthFrom(new Date(2026, 11, 1), 13).toISOString()).toBe(
      "2028-01-01T00:00:00.000Z",
    );
  });

  it("uses the visitor's local month, not the UTC one", () => {
    // West of UTC, 23:30 on 31 December local time is already January in
    // UTC, so reading the UTC month would give the wrong year.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const lateOnNewYearsEve = new Date(2026, 11, 31, 23, 30);
      expect(lateOnNewYearsEve.getUTCMonth()).toBe(0);

      expect(targetMonthFrom(lateOnNewYearsEve, 0).toISOString()).toBe(
        "2026-12-01T00:00:00.000Z",
      );
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

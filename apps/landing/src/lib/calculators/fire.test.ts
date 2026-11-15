import { describe, expect, it } from "vitest";
import {
  FIRE_DEFAULT_RETURN,
  FIRE_DEFAULT_WITHDRAWAL_RATE,
  FIRE_MAX_AMOUNT,
  FIRE_MAX_YEARS,
  FIRE_WITHDRAWAL_RATE_MAX,
  FIRE_WITHDRAWAL_RATE_MIN,
  FIRE_WORKED_EXAMPLE,
  calculateFire,
  fireTargetYear,
  normalizeFireInputs,
  splitMonths,
  toMonthIndex,
  withSpendingCut,
  type FireInputs,
} from "./fire";
import { formatFireDuration, formatFireProgress, formatFireRate } from "./fireFormat";

const base: FireInputs = {
  annualSpending: 30000,
  currentAssets: 0,
  monthlyContribution: 1000,
  realReturn: 0,
  withdrawalRate: 4,
};

describe("calculateFire", () => {
  it("sets the FIRE number to annual spending divided by the withdrawal rate", () => {
    expect(calculateFire({ ...base, withdrawalRate: 4 }).fireNumber).toBe(750000);
    expect(calculateFire({ ...base, withdrawalRate: 2.5 }).fireNumber).toBe(1200000);
    expect(calculateFire({ ...base, withdrawalRate: 6 }).fireNumber).toBe(500000);
  });

  it("reports progress as current assets over the FIRE number", () => {
    const result = calculateFire({ ...base, currentAssets: 150000 });

    expect(result.progress).toBeCloseTo(20, 10);
  });

  it("counts months of contributions exactly when the return is zero", () => {
    // 300 000 target, 1 000 a month and nothing else: 300 months.
    const result = calculateFire({ ...base, annualSpending: 12000, monthlyContribution: 1000 });

    expect(result.status).toBe("projected");
    expect(result.monthsToTarget).toBe(300);
    expect(result.path).toHaveLength(26);
    expect(result.path[0]).toEqual({ year: 0, assets: 0, contributed: 0 });
    expect(result.path[25]).toEqual({ year: 25, assets: 300000, contributed: 300000 });
  });

  it("compounds monthly at the rate equivalent to the annual real return", () => {
    // No contributions: 100 000 doubles at 5% a year after ln 2 / ln 1.05 = 14.2 years,
    // so the target is first met in month 171.
    const result = calculateFire({
      ...base,
      annualSpending: 8000,
      currentAssets: 100000,
      monthlyContribution: 0,
      realReturn: 5,
    });

    expect(result.fireNumber).toBe(200000);
    expect(result.monthsToTarget).toBe(171);
    // One year of growth with no contributions is exactly the annual return.
    expect(result.path[1].assets).toBe(105000);
    expect(result.path[1].contributed).toBe(100000);
  });

  it("adds each contribution at the end of the month", () => {
    const result = calculateFire({
      ...base,
      annualSpending: 1_000_000,
      currentAssets: 0,
      monthlyContribution: 100,
      realReturn: 12,
    });
    const monthlyRate = Math.pow(1.12, 1 / 12) - 1;
    let expected = 0;
    for (let month = 0; month < 12; month++) expected = expected * (1 + monthlyRate) + 100;

    expect(result.path[1].assets).toBe(Math.round(expected));
    expect(result.path[1].contributed).toBe(1200);
  });

  it("projects the worked example", () => {
    const result = calculateFire(FIRE_WORKED_EXAMPLE);

    expect(result.fireNumber).toBe(600000);
    expect(result.progress).toBeCloseTo(10, 10);
    expect(result.status).toBe("projected");
    expect(result.monthsToTarget).toBe(279);
    expect(splitMonths(279)).toEqual({ years: 23, months: 3 });
    // The path runs to the end of the year the target is met in.
    expect(result.path).toHaveLength(25);
    expect(result.path.at(-1)?.assets).toBeGreaterThanOrEqual(600000);
    expect(result.path.at(-2)?.assets).toBeLessThan(600000);
  });

  it("is already there when current assets meet or pass the target", () => {
    for (const currentAssets of [750000, 900000]) {
      const result = calculateFire({ ...base, currentAssets, monthlyContribution: 0 });

      expect(result.status).toBe("reached");
      expect(result.monthsToTarget).toBe(0);
      expect(result.progress).toBeGreaterThanOrEqual(100);
    }
    expect(calculateFire({ ...base, currentAssets: 900000 }).progress).toBeCloseTo(120, 10);
  });

  it("never reaches the target with no contribution and no growth", () => {
    const result = calculateFire({ ...base, currentAssets: 1000, monthlyContribution: 0, realReturn: 0 });

    expect(result.status).toBe("unreachable");
    expect(result.monthsToTarget).toBeNull();
    expect(result.path).toEqual([]);
  });

  it("never reaches the target with nothing invested and nothing added, even with growth", () => {
    const result = calculateFire({ ...base, currentAssets: 0, monthlyContribution: 0, realReturn: 7 });

    expect(result.status).toBe("unreachable");
  });

  it("never reaches the target when a negative return caps the balance below it", () => {
    // At -2% a year, 100 a month levels off near 60 000, far below 750 000.
    const result = calculateFire({ ...base, monthlyContribution: 100, realReturn: -2 });

    expect(result.status).toBe("unreachable");
  });

  it("stops at the horizon when the target is further away", () => {
    // 10 a month at 0% needs 6 250 years to reach 750 000.
    const result = calculateFire({ ...base, monthlyContribution: 10 });

    expect(result.status).toBe("beyondHorizon");
    expect(result.monthsToTarget).toBeNull();
    expect(result.path).toHaveLength(FIRE_MAX_YEARS + 1);
    expect(result.path.at(-1)).toEqual({ year: FIRE_MAX_YEARS, assets: 12000, contributed: 12000 });
  });

  it("asks for spending when annual spending is zero or empty", () => {
    for (const annualSpending of [0, Number.NaN, -500]) {
      const result = calculateFire({ ...base, annualSpending });

      expect(result.status).toBe("noSpending");
      expect(result.fireNumber).toBe(0);
      expect(result.progress).toBeNull();
      expect(result.monthsToTarget).toBeNull();
      expect(result.path).toEqual([]);
    }
  });

  it("stays finite for very large values", () => {
    const result = calculateFire({
      annualSpending: 1e15,
      currentAssets: 1e15,
      monthlyContribution: 1e15,
      realReturn: 1000,
      withdrawalRate: 0,
    });

    expect(result.inputs.annualSpending).toBe(FIRE_MAX_AMOUNT);
    expect(result.inputs.withdrawalRate).toBe(FIRE_WITHDRAWAL_RATE_MIN);
    expect(Number.isFinite(result.fireNumber)).toBe(true);
    expect(result.status).toBe("projected");
    expect(result.path.every((point) => Number.isFinite(point.assets))).toBe(true);
  });
});

describe("normalizeFireInputs", () => {
  it("keeps the withdrawal rate between 2.5% and 6%", () => {
    expect(normalizeFireInputs({ ...base, withdrawalRate: 1 }).withdrawalRate).toBe(FIRE_WITHDRAWAL_RATE_MIN);
    expect(normalizeFireInputs({ ...base, withdrawalRate: 9 }).withdrawalRate).toBe(FIRE_WITHDRAWAL_RATE_MAX);
    expect(normalizeFireInputs({ ...base, withdrawalRate: 3.5 }).withdrawalRate).toBe(3.5);
    expect(normalizeFireInputs({ ...base, withdrawalRate: Number.NaN }).withdrawalRate).toBe(
      FIRE_DEFAULT_WITHDRAWAL_RATE,
    );
  });

  it("treats empty or negative amounts as zero", () => {
    const inputs = normalizeFireInputs({
      ...base,
      currentAssets: Number.NaN,
      monthlyContribution: -100,
      realReturn: Number.NaN,
    });

    expect(inputs.currentAssets).toBe(0);
    expect(inputs.monthlyContribution).toBe(0);
    expect(inputs.realReturn).toBe(0);
  });

  it("defaults to a 5% real return and a 4% withdrawal rate", () => {
    expect(FIRE_DEFAULT_RETURN).toBe(5);
    expect(FIRE_DEFAULT_WITHDRAWAL_RATE).toBe(4);
    expect(FIRE_WORKED_EXAMPLE.realReturn).toBe(FIRE_DEFAULT_RETURN);
    expect(FIRE_WORKED_EXAMPLE.withdrawalRate).toBe(FIRE_DEFAULT_WITHDRAWAL_RATE);
  });
});

describe("fireTargetYear", () => {
  it("adds the months to the start month", () => {
    const start = toMonthIndex(new Date(2026, 10, 15));

    expect(start).toBe(2026 * 12 + 10);

    expect(fireTargetYear(start, 0)).toBe(2026);
    expect(fireTargetYear(start, 1)).toBe(2026);
    expect(fireTargetYear(start, 2)).toBe(2027);
    expect(fireTargetYear(start, 279)).toBe(2050);
  });
});

describe("splitMonths", () => {
  it("splits a month count into whole years and months", () => {
    expect(splitMonths(0)).toEqual({ years: 0, months: 0 });
    expect(splitMonths(11)).toEqual({ years: 0, months: 11 });
    expect(splitMonths(24)).toEqual({ years: 2, months: 0 });
  });
});

describe("formatFireDuration", () => {
  it("writes years and months in the page's language", () => {
    expect(formatFireDuration("en", 279)).toBe("23 years and 3 months");
    expect(formatFireDuration("pt", 279)).toBe("23 anos e 3 meses");
    expect(formatFireDuration("de", 13)).toBe("1 Jahr und 1 Monat");
    expect(formatFireDuration("fr", 24)).toBe("2 ans");
    expect(formatFireDuration("it", 5)).toBe("5 mesi");
  });
});

describe("withSpendingCut", () => {
  it("cuts the spending the calculation used, not what was typed", () => {
    expect(withSpendingCut(FIRE_WORKED_EXAMPLE).annualSpending).toBe(21600);
    // Typed above the cap: the cut applies to the capped amount.
    expect(withSpendingCut({ ...base, annualSpending: 1e15 }).annualSpending).toBe(FIRE_MAX_AMOUNT * 0.9);
    // Out-of-range rates come back normalized too.
    expect(withSpendingCut({ ...base, withdrawalRate: 9 }).withdrawalRate).toBe(FIRE_WITHDRAWAL_RATE_MAX);
  });
});

describe("formatFireRate", () => {
  it("shows up to two decimals, so the rate shown is the rate used", () => {
    expect(formatFireRate("en", 4)).toBe("4%");
    expect(formatFireRate("en", 2.5)).toBe("2.5%");
    expect(formatFireRate("en", 3.25)).toBe("3.25%");
    expect(formatFireRate("pt", 3.25)).toBe("3,25%");
  });
});

describe("formatFireProgress", () => {
  it("shows one decimal", () => {
    expect(formatFireProgress("en", 10)).toBe("10.0%");
    expect(formatFireProgress("en", calculateFire(FIRE_WORKED_EXAMPLE).progress ?? 0)).toBe("10.0%");
    expect(formatFireProgress("en", 120)).toBe("120.0%");
  });

  it("never shows 100% before the target is reached", () => {
    // 599 800 of 600 000 is 99.97%, which rounding would show as 100.0%.
    const result = calculateFire({ ...FIRE_WORKED_EXAMPLE, currentAssets: 599800 });

    expect(result.status).toBe("projected");
    expect(formatFireProgress("en", result.progress ?? 0)).toBe("99.9%");
    expect(formatFireProgress("en", 99.99999)).toBe("99.9%");
    expect(formatFireProgress("en", 100)).toBe("100.0%");
  });
});

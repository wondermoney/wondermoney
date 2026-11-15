import { describe, expect, it } from "vitest";
import {
  DEBT_TO_INCOME_WORKED_EXAMPLE,
  applyDebtScenario,
  classifyDebtToIncome,
  compareDebtScenario,
  computeDebtToIncome,
} from "./debtToIncome";

describe("computeDebtToIncome", () => {
  it("divides total monthly payments by net monthly income", () => {
    const result = computeDebtToIncome({
      monthlyIncome: 2800,
      payments: [720, 0, 210, 70, 0],
    });

    expect(result.status).toBe("ok");
    expect(result.totalPayments).toBe(1000);
    expect(result.ratio).toBe(35.7);
    expect(result.band).toBe("caution");
    expect(result.remainingIncome).toBe(1800);
    expect(result.exceedsIncome).toBe(false);
  });

  it("reports 0% and a healthy band when there are no debts", () => {
    const result = computeDebtToIncome({ monthlyIncome: 2000, payments: [] });

    expect(result.status).toBe("ok");
    expect(result.totalPayments).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.band).toBe("healthy");
    expect(result.remainingIncome).toBe(2000);
  });

  it("returns no ratio when income is zero, empty or negative", () => {
    for (const monthlyIncome of [0, Number.NaN, -500]) {
      const result = computeDebtToIncome({ monthlyIncome, payments: [300] });

      expect(result.status).toBe("noIncome");
      expect(result.ratio).toBeNull();
      expect(result.band).toBeNull();
      expect(result.totalPayments).toBe(300);
    }
  });

  it("ignores empty, negative and non-finite payment amounts", () => {
    const result = computeDebtToIncome({
      monthlyIncome: 1000,
      payments: [200, Number.NaN, -50, Number.POSITIVE_INFINITY, 100],
    });

    expect(result.totalPayments).toBe(300);
    expect(result.ratio).toBe(30);
  });

  it("flags payments above income and keeps the ratio over 100%", () => {
    const result = computeDebtToIncome({ monthlyIncome: 1000, payments: [900, 350] });

    expect(result.status).toBe("ok");
    expect(result.ratio).toBe(125);
    expect(result.band).toBe("high");
    expect(result.exceedsIncome).toBe(true);
    expect(result.remainingIncome).toBe(-250);
  });

  it("stays finite for very large values", () => {
    const result = computeDebtToIncome({ monthlyIncome: 1, payments: [1e12] });

    expect(Number.isFinite(result.ratio)).toBe(true);
    expect(result.band).toBe("high");
  });

  it("reports figures too large for a finite total instead of an infinite ratio", () => {
    const result = computeDebtToIncome({ monthlyIncome: 2000, payments: [1e308, 1e308] });

    expect(result.status).toBe("outOfRange");
    expect(result.ratio).toBeNull();
    expect(result.band).toBeNull();
    expect(result.remainingIncome).toBeNull();
  });

  it("reports a ratio too large to be finite as out of range", () => {
    const result = computeDebtToIncome({ monthlyIncome: 1e-300, payments: [1e10] });

    expect(result.status).toBe("outOfRange");
    expect(result.ratio).toBeNull();
  });

  it("works out the page's worked example", () => {
    const { monthlyIncome, rows } = DEBT_TO_INCOME_WORKED_EXAMPLE;
    const result = computeDebtToIncome({
      monthlyIncome,
      payments: rows.map((row) => row.amount),
    });

    expect(result.totalPayments).toBe(1000);
    expect(result.ratio).toBe(35.7);
    expect(result.band).toBe("caution");
  });
});

describe("classifyDebtToIncome", () => {
  it("puts below 30% in healthy, 30% to 40% in caution and above 40% in high", () => {
    expect(classifyDebtToIncome(0)).toBe("healthy");
    expect(classifyDebtToIncome(29.9)).toBe("healthy");
    expect(classifyDebtToIncome(30)).toBe("caution");
    expect(classifyDebtToIncome(40)).toBe("caution");
    expect(classifyDebtToIncome(40.1)).toBe("high");
  });

  it("classifies on the rounded ratio the page shows", () => {
    // 1199.8 / 4000 = 29.995% shows as 30.0%, so it reads as caution.
    const result = computeDebtToIncome({ monthlyIncome: 4000, payments: [1199.8] });

    expect(result.ratio).toBe(30);
    expect(result.band).toBe("caution");
  });
});

describe("applyDebtScenario", () => {
  const payments = [
    { id: "home", amount: 720 },
    { id: "car", amount: 210 },
  ];

  it("changes one payment and leaves the others alone", () => {
    expect(
      applyDebtScenario(payments, { kind: "change", paymentId: "car", amount: 0 }),
    ).toEqual([720, 0]);
  });

  it("adds a new payment", () => {
    expect(applyDebtScenario(payments, { kind: "add", amount: 250 })).toEqual([720, 210, 250]);
  });

  it("leaves the payments unchanged when the changed row no longer exists", () => {
    expect(
      applyDebtScenario(payments, { kind: "change", paymentId: "gone", amount: 0 }),
    ).toEqual([720, 210]);
  });
});

describe("compareDebtScenario", () => {
  it("shows the current and the new ratio with the difference in points", () => {
    const comparison = compareDebtScenario(2800, DEBT_TO_INCOME_WORKED_EXAMPLE.rows, {
      kind: "change",
      paymentId: "car",
      amount: 0,
    });

    expect(comparison.current.ratio).toBe(35.7);
    expect(comparison.scenario.ratio).toBe(28.2);
    expect(comparison.scenario.band).toBe("healthy");
    expect(comparison.pointsChange).toBe(-7.5);
  });

  it("moves the worked example from the caution band to the healthy band, as the page says", () => {
    const { monthlyIncome, rows, scenario } = DEBT_TO_INCOME_WORKED_EXAMPLE;
    const comparison = compareDebtScenario(monthlyIncome, rows, scenario);

    expect(comparison.current.band).toBe("caution");
    expect(comparison.scenario.band).toBe("healthy");
  });

  it("raises the ratio when a new loan payment is added", () => {
    const comparison = compareDebtScenario(2000, [{ id: "home", amount: 500 }], {
      kind: "add",
      amount: 300,
    });

    expect(comparison.current.ratio).toBe(25);
    expect(comparison.scenario.ratio).toBe(40);
    expect(comparison.pointsChange).toBe(15);
  });

  it("has no difference to show without income", () => {
    const comparison = compareDebtScenario(0, [{ id: "home", amount: 500 }], {
      kind: "add",
      amount: 300,
    });

    expect(comparison.pointsChange).toBeNull();
  });
});

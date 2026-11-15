import { describe, expect, it } from "vitest";
import {
  BORROWING_CAPACITY_EXAMPLE,
  BORROWING_CAPACITY_LIMITS,
  computeBorrowingCapacity,
  type BorrowingCapacityInput,
  type BorrowingCapacityResult,
} from "./borrowingCapacity";
import { computeMortgage } from "./mortgage";

const base: BorrowingCapacityInput = { ...BORROWING_CAPACITY_EXAMPLE };

function calculate(overrides: Partial<BorrowingCapacityInput> = {}): BorrowingCapacityResult {
  const calculation = computeBorrowingCapacity({ ...base, ...overrides });
  if (!calculation.ok) {
    throw new Error(`expected a result, got ${JSON.stringify(calculation.errors)}`);
  }
  return calculation.result;
}

function calculateOk(overrides: Partial<BorrowingCapacityInput> = {}) {
  const result = calculate(overrides);
  if (result.status !== "ok") throw new Error(`expected status ok, got ${result.status}`);
  return result;
}

function errorsFor(overrides: Partial<BorrowingCapacityInput>) {
  const calculation = computeBorrowingCapacity({ ...base, ...overrides });
  if (calculation.ok) throw new Error("expected validation errors");
  return calculation.errors;
}

const cents = (value: number) => Math.round(value * 100);

/** Rows that must add up on screen, checked in whole cents. */
function expectConsistent(result: ReturnType<typeof calculateOk>, savings: number) {
  expect(cents(result.price)).toBe(cents(result.loan) + cents(result.downPayment));
  expect(cents(result.cashNeeded)).toBe(cents(result.downPayment) + cents(result.purchaseCosts));
  expect(cents(result.cashNeeded)).toBeLessThanOrEqual(cents(savings));
  expect(cents(result.loan)).toBeLessThanOrEqual(cents(result.monthly.maxLoan));
  // The loan never goes over the loan-to-value cap.
  expect(result.loan).toBeLessThanOrEqual((result.price * result.cash.loanToValue) / 100 + 1e-9);
  for (const value of [result.price, result.loan, result.downPayment, result.purchaseCosts]) {
    expect(Number.isInteger(Math.round(value * 100 * 1e6) / 1e6)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
}

describe("computeBorrowingCapacity: the monthly limit", () => {
  it("takes the allowed share of income, minus existing payments, as the room for a new payment", () => {
    const { monthly } = calculate();

    // 3,200 × 35% = 1,120; minus 250 already paid = 870 a month for the new loan.
    expect(monthly.allowedPayments).toBe(1120);
    expect(monthly.existingPayments).toBe(250);
    expect(monthly.maxNewPayment).toBe(870);
    expect(monthly.hasRoom).toBe(true);
  });

  it("turns that payment into the largest loan at the rate and term, rounded down to the cent", () => {
    const { monthly } = calculate();

    // 870 × (1 − (1 + 0.035/12)^−360) ÷ (0.035/12) = 193,744.63…
    const r = 0.035 / 12;
    const exact = (870 * (1 - (1 + r) ** -360)) / r;
    expect(monthly.maxLoan).toBe(Math.floor(exact * 100) / 100);
    expect(monthly.maxLoan).toBe(193_744.63);
  });

  it("chooses a loan whose payment, worked out by the mortgage calculator, fits the room", () => {
    for (const annualRate of [0, 1.25, 3.5, 7.9, 15, 30]) {
      for (const termYears of [1, 10, 25, 30, 50]) {
        const { monthly } = calculate({ annualRate, termYears });
        const mortgage = computeMortgage({
          loanAmount: monthly.maxLoan,
          termYears,
          annualRate,
          monthlyFees: 0,
        });
        if (!mortgage.ok) throw new Error("the mortgage engine rejected the loan");
        expect(mortgage.result.monthlyPayment).toBeLessThanOrEqual(monthly.maxNewPayment);
        // One more euro of loan would no longer fit.
        const bigger = computeMortgage({
          loanAmount: monthly.maxLoan + 1,
          termYears,
          annualRate,
          monthlyFees: 0,
        });
        if (!bigger.ok) throw new Error("the mortgage engine rejected the loan");
        expect(bigger.result.monthlyPayment).toBeGreaterThanOrEqual(monthly.maxNewPayment);
      }
    }
  });

  it("at 0% divides the payments evenly over the term", () => {
    const { monthly } = calculate({ annualRate: 0 });

    expect(monthly.maxLoan).toBe(870 * 360);
  });

  it("works with the price this limit allows when every euro of savings goes into the purchase", () => {
    const { monthly } = calculate();

    // (193,744.63 + 40,000) ÷ 1.07 = 218,452.92…
    expect(monthly.priceCeiling).toBe(218_452.92);
  });

  it("leaves no room for a new loan when existing payments use up the allowed share", () => {
    for (const existingPayments of [1120, 1500, 3200, 5000]) {
      const { monthly } = calculate({ existingPayments });
      expect(monthly.hasRoom).toBe(false);
      expect(monthly.maxNewPayment).toBe(0);
      expect(monthly.maxLoan).toBe(0);
    }
  });

  it("treats a room too small for the smallest loan as no room", () => {
    // 0.10 a month left: a loan of a few euros, under the mortgage calculator's minimum.
    const { monthly } = calculate({ existingPayments: 1119.9 });

    expect(monthly.maxNewPayment).toBe(0.1);
    expect(monthly.maxLoan).toBe(0);
    expect(monthly.hasRoom).toBe(false);
  });

  it("rounds the allowed share down to the cent", () => {
    const { monthly } = calculate({ monthlyIncome: 1234.57, maxDebtShare: 33.3 });

    // 1,234.57 × 33.3% = 411.11181
    expect(monthly.allowedPayments).toBe(411.11);
  });
});

describe("computeBorrowingCapacity: the upfront cash limit", () => {
  it("needs the deposit the loan-to-value leaves plus the purchase costs from savings", () => {
    const { cash } = calculate();

    // 10% deposit + 7% costs = 17% of the price from savings: 40,000 ÷ 0.17.
    expect(cash.depositShare).toBe(10);
    expect(cash.cashShare).toBe(17);
    expect(cash.priceCeiling).toBe(235_294.11);
  });

  it("has no price ceiling when nothing has to come from savings", () => {
    const { cash } = calculate({ maxLoanToValue: 100, purchaseCostsRate: 0 });

    expect(cash.cashShare).toBe(0);
    expect(cash.priceCeiling).toBeNull();
  });

  it("allows no price from zero savings while the price needs a deposit or costs", () => {
    expect(calculate({ savings: 0 }).cash.priceCeiling).toBe(0);
    expect(calculate({ savings: 0, maxLoanToValue: 100 }).cash.priceCeiling).toBe(0);
  });
});

describe("computeBorrowingCapacity: the combined result", () => {
  it("takes the lower of the two prices, with the loan, deposit and costs that reach it", () => {
    const result = calculateOk();

    expect(result.binding).toBe("monthly");
    expect(result.price).toBe(218_452.92);
    // Rounding the costs to the cent leaves the loan a cent under the monthly limit.
    expect(result.loan).toBe(193_744.62);
    expect(result.downPayment).toBe(24_708.3);
    expect(result.purchaseCosts).toBe(15_291.7);
    expect(result.cashNeeded).toBe(40_000);
    expectConsistent(result, base.savings);
  });

  it("takes the monthly payment and schedule from the mortgage calculator", () => {
    const result = calculateOk();
    const mortgage = computeMortgage({
      loanAmount: result.loan,
      termYears: base.termYears,
      annualRate: base.annualRate,
      monthlyFees: 0,
    });
    if (!mortgage.ok) throw new Error("the mortgage engine rejected the loan");

    expect(result.mortgage).toEqual(mortgage.result);
    expect(result.mortgage?.monthlyPayment).toBeLessThanOrEqual(870);
    expect(result.mortgage?.monthlyPayment).toBe(870);
  });

  it("reports the debt-to-income ratio with the new payment, in the debt-to-income tool's bands", () => {
    const result = calculateOk();

    // (250 + 870) ÷ 3,200 = 35%
    expect(result.debtToIncome.status).toBe("ok");
    expect(result.debtToIncome.ratio).toBe(35);
    expect(result.debtToIncome.band).toBe("caution");
  });

  it("names the savings as the limit when they allow less than the income", () => {
    const result = calculateOk({ savings: 20_000 });

    // 20,000 ÷ 0.17 = 117,647.05; a 90% loan of it is well within the monthly room.
    expect(result.binding).toBe("cash");
    expect(result.price).toBe(117_647.05);
    expect(result.loan).toBeLessThanOrEqual(result.price * 0.9);
    expect(result.loan).toBeCloseTo(105_882.35, 1);
    expectConsistent(result, 20_000);
    expect(result.mortgage?.monthlyPayment).toBeLessThan(870);
  });

  it("says how much more income would lift the monthly limit to the savings limit", () => {
    const result = calculateOk();
    if (result.lift?.kind !== "income") throw new Error("expected an income lift");

    expect(result.lift.price).toBe(235_294.11);
    // Check the claim: with that much more income the price reaches the savings limit.
    const lifted = calculateOk({ monthlyIncome: base.monthlyIncome + result.lift.extraMonthlyIncome });
    expect(lifted.price).toBeGreaterThanOrEqual(235_294.11 - 0.01);
    expect(lifted.binding).not.toBe("monthly");
    // And it is the smallest whole euro that does.
    const short = calculateOk({
      monthlyIncome: base.monthlyIncome + result.lift.extraMonthlyIncome - 1,
    });
    expect(short.price).toBeLessThan(235_294.11);
    expect(Number.isInteger(result.lift.extraMonthlyIncome)).toBe(true);
  });

  it("says how much more savings would lift the savings limit to the monthly limit", () => {
    const result = calculateOk({ savings: 20_000 });
    if (result.lift?.kind !== "savings") throw new Error("expected a savings lift");

    const lifted = calculateOk({ savings: 20_000 + result.lift.extraSavings });
    expect(lifted.binding).not.toBe("cash");
    expect(lifted.price).toBeGreaterThanOrEqual(result.lift.price - 0.01);
    const short = calculateOk({ savings: 20_000 + result.lift.extraSavings - 1 });
    expect(short.binding).toBe("cash");
    expect(Number.isInteger(result.lift.extraSavings)).toBe(true);
  });

  it("with no savings ceiling, says what each extra 100 of income adds to the price", () => {
    const result = calculateOk({ maxLoanToValue: 100, purchaseCostsRate: 0 });
    if (result.lift?.kind !== "incomeStep") throw new Error("expected an income step");

    expect(result.binding).toBe("monthly");
    expect(result.price).toBe(193_744.63 + 40_000);
    expect(result.lift.step).toBe(100);
    // 35 more a month of payment at 3.5% over 30 years: about 7,794.
    const lifted = calculateOk({ maxLoanToValue: 100, purchaseCostsRate: 0, monthlyIncome: 3300 });
    expect(Math.abs(lifted.price - result.price - result.lift.priceIncrease)).toBeLessThan(1);
  });

  it("with no room for a new loan, prices what savings alone can buy", () => {
    const result = calculateOk({ existingPayments: 1500 });

    expect(result.monthly.hasRoom).toBe(false);
    expect(result.loan).toBe(0);
    expect(result.mortgage).toBeNull();
    // 40,000 ÷ 1.07 = 37,383.17
    expect(result.price).toBe(37_383.17);
    expect(result.binding).toBe("monthly");
    expectConsistent(result, 40_000);
    // Existing payments alone set the ratio.
    expect(result.debtToIncome.ratio).toBe(46.9);
    expect(result.debtToIncome.band).toBe("high");
  });

  it("with no savings and a loan-to-value under 100%, can reach no price", () => {
    const result = calculateOk({ savings: 0 });

    expect(result.price).toBe(0);
    expect(result.loan).toBe(0);
    expect(result.binding).toBe("cash");
    if (result.lift?.kind !== "savings") throw new Error("expected a savings lift");
    expect(result.lift.extraSavings).toBeGreaterThan(0);
    expect(calculateOk({ savings: result.lift.extraSavings }).binding).not.toBe("cash");
  });

  it("with no savings, no room and nothing to lift alone, reaches no price and names both limits", () => {
    const result = calculateOk({ savings: 0, existingPayments: 2000 });

    expect(result.price).toBe(0);
    expect(result.binding).toBe("both");
    expect(result.lift).toBeNull();
  });

  it("at 100% loan-to-value still needs savings for the purchase costs", () => {
    const result = calculateOk({ maxLoanToValue: 100, savings: 10_000 });

    // 10,000 ÷ 7% = 142,857.14, a loan of the whole price.
    expect(result.binding).toBe("cash");
    expect(result.price).toBe(142_857.14);
    expect(result.downPayment).toBe(0);
    expect(result.loan).toBe(142_857.14);
    expectConsistent(result, 10_000);
  });

  it("buys with savings alone when the loan the savings allow would be under the minimum", () => {
    const result = calculateOk({ savings: 10 });

    expect(result.loan).toBe(0);
    expect(result.mortgage).toBeNull();
    // 10 ÷ 1.07
    expect(result.price).toBe(9.34);
    expectConsistent(result, 10);
  });

  it("keeps every figure consistent to the cent across awkward inputs", () => {
    const cases: Array<Partial<BorrowingCapacityInput>> = [
      { monthlyIncome: 2345.67, existingPayments: 123.45, savings: 31_234.56 },
      { monthlyIncome: 9999.99, maxDebtShare: 41.7, annualRate: 4.15, savings: 77_777.77 },
      { purchaseCostsRate: 8.35, maxLoanToValue: 85.5, savings: 54_321.09 },
      { monthlyIncome: 1800, existingPayments: 0, savings: 12_345.67, termYears: 40 },
      { annualRate: 0, savings: 1_000_000 },
      { maxLoanToValue: 50, savings: 33_333.33, purchaseCostsRate: 0 },
      { maxLoanToValue: 100, purchaseCostsRate: 0, savings: 0 },
    ];
    for (const overrides of cases) {
      const result = calculateOk(overrides);
      expectConsistent(result, overrides.savings ?? base.savings);
    }
  });

  it("leaves rich buyers to their savings: a cash price above the loan limit", () => {
    const result = calculateOk({ savings: 5_000_000 });

    expect(result.binding).toBe("monthly");
    expect(result.loan).toBe(193_744.63);
    expectConsistent(result, 5_000_000);
  });

  it("flags figures beyond what the mortgage calculator works out", () => {
    const result = calculate({
      monthlyIncome: BORROWING_CAPACITY_LIMITS.maxMonthlyAmount,
      maxDebtShare: 60,
      annualRate: 0,
      termYears: 50,
      savings: BORROWING_CAPACITY_LIMITS.maxSavings,
    });

    expect(result.status).toBe("outOfRange");
    expect(Number.isFinite(result.monthly.maxLoan)).toBe(true);
  });

  it("handles the largest figures it accepts without losing cents", () => {
    const result = calculateOk({
      monthlyIncome: BORROWING_CAPACITY_LIMITS.maxMonthlyAmount,
      maxDebtShare: 10,
      annualRate: 30,
      termYears: 50,
      savings: 20_000_000,
    });

    expectConsistent(result, 20_000_000);
  });
});

describe("computeBorrowingCapacity: validation", () => {
  it("needs a positive income", () => {
    expect(errorsFor({ monthlyIncome: Number.NaN }).monthlyIncome).toBe("required");
    expect(errorsFor({ monthlyIncome: 0 }).monthlyIncome).toBe("required");
    expect(errorsFor({ monthlyIncome: -1 }).monthlyIncome).toBe("required");
    expect(
      errorsFor({ monthlyIncome: BORROWING_CAPACITY_LIMITS.maxMonthlyAmount + 1 }).monthlyIncome,
    ).toBe("tooLarge");
  });

  it("reads empty existing payments, savings and purchase costs as none", () => {
    const result = calculateOk({
      existingPayments: Number.NaN,
      savings: Number.NaN,
      purchaseCostsRate: Number.NaN,
      annualRate: 0,
      maxLoanToValue: 100,
    });

    expect(result.monthly.existingPayments).toBe(0);
    expect(result.cash.savings).toBe(0);
    expect(result.cash.cashShare).toBe(0);
    expect(result.monthly.maxLoan).toBe(1120 * 360);
  });

  it("asks for the interest rate instead of reading an empty one as 0%", () => {
    expect(errorsFor({ annualRate: Number.NaN })).toEqual({ annualRate: "required" });
  });

  it("rejects negative amounts", () => {
    const errors = errorsFor({ existingPayments: -1, savings: -1, purchaseCostsRate: -1, annualRate: -1 });

    expect(errors).toEqual({
      existingPayments: "negative",
      savings: "negative",
      purchaseCostsRate: "negative",
      annualRate: "negative",
    });
  });

  it("keeps the debt share and loan-to-value within their ranges", () => {
    expect(errorsFor({ maxDebtShare: Number.NaN }).maxDebtShare).toBe("required");
    expect(errorsFor({ maxDebtShare: 9.9 }).maxDebtShare).toBe("tooSmall");
    expect(errorsFor({ maxDebtShare: 60.1 }).maxDebtShare).toBe("tooLarge");
    expect(calculate({ maxDebtShare: 10 }).monthly.allowedPayments).toBe(320);
    expect(calculate({ maxDebtShare: 60 }).monthly.allowedPayments).toBe(1920);

    expect(errorsFor({ maxLoanToValue: Number.NaN }).maxLoanToValue).toBe("required");
    expect(errorsFor({ maxLoanToValue: 49 }).maxLoanToValue).toBe("tooSmall");
    expect(errorsFor({ maxLoanToValue: 101 }).maxLoanToValue).toBe("tooLarge");
  });

  it("takes the mortgage calculator's limits on rate and term", () => {
    expect(errorsFor({ termYears: Number.NaN }).termYears).toBe("required");
    expect(errorsFor({ termYears: 0 }).termYears).toBe("required");
    expect(errorsFor({ termYears: BORROWING_CAPACITY_LIMITS.maxTermYears + 1 }).termYears).toBe(
      "tooLarge",
    );
    expect(errorsFor({ annualRate: BORROWING_CAPACITY_LIMITS.maxAnnualRate + 1 }).annualRate).toBe(
      "tooLarge",
    );
  });

  it("caps very large amounts with a message instead of a meaningless figure", () => {
    expect(errorsFor({ existingPayments: 1e12 }).existingPayments).toBe("tooLarge");
    expect(errorsFor({ savings: 1e15 }).savings).toBe("tooLarge");
    expect(errorsFor({ purchaseCostsRate: 31 }).purchaseCostsRate).toBe("tooLarge");
    expect(errorsFor({ monthlyIncome: Number.POSITIVE_INFINITY }).monthlyIncome).toBe("tooLarge");
  });
});

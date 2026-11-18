import { describe, expect, it } from "vitest";
import { computeMortgage } from "./mortgage";
import {
  PERSONAL_LOAN_EXAMPLE,
  PERSONAL_LOAN_LIMITS,
  annualPercentageRate,
  computePersonalLoan,
  type PersonalLoanInput,
  type PersonalLoanResult,
} from "./personalLoan";

const base: PersonalLoanInput = {
  amount: 10_000,
  termMonths: 60,
  annualRate: 8,
  upfrontFees: 0,
  monthlyFees: 0,
};

function compute(overrides: Partial<PersonalLoanInput> = {}): PersonalLoanResult {
  const calculation = computePersonalLoan({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(`Unexpected errors: ${JSON.stringify(calculation.errors)}`);
  return calculation.result;
}

function errorsFor(overrides: Partial<PersonalLoanInput>) {
  const calculation = computePersonalLoan({ ...base, ...overrides });
  return calculation.ok ? {} : calculation.errors;
}

const cents = (value: number) => Math.round(value * 100);

/**
 * The borrower's net present value at an annual rate, worked independently of the module:
 * what is received at month 0 less every monthly outflow, each discounted by (1 + y)^(m ÷ 12).
 */
function presentValue(result: PersonalLoanResult, annualRatePercent: number): number {
  const y = annualRatePercent / 100;
  return result.schedule.reduce(
    (sum, row) => sum - row.payment * Math.pow(1 + y, -row.month / 12),
    result.amountReceived,
  );
}

/** Every total adds up from the schedule to the cent. */
function expectConsistent(result: PersonalLoanResult, input: PersonalLoanInput) {
  const sum = (pick: (row: PersonalLoanResult["schedule"][number]) => number) =>
    result.schedule.reduce((total, row) => total + cents(pick(row)), 0);
  const upfront = cents(Number.isNaN(input.upfrontFees) ? 0 : input.upfrontFees);

  expect(result.schedule).toHaveLength(result.months);
  expect(result.schedule.at(-1)?.balance).toBe(0);
  expect(sum((row) => row.principal)).toBe(cents(input.amount));
  expect(sum((row) => row.interest)).toBe(cents(result.totalInterest));
  expect(sum((row) => row.fees)).toBe(cents(result.totalMonthlyFees));
  for (const row of result.schedule) {
    expect(cents(row.payment)).toBe(cents(row.principal) + cents(row.interest) + cents(row.fees));
  }
  expect(cents(result.upfrontFees)).toBe(upfront);
  expect(cents(result.totalFees)).toBe(upfront + cents(result.totalMonthlyFees));
  expect(cents(result.totalCostOfCredit)).toBe(cents(result.totalInterest) + cents(result.totalFees));
  expect(cents(result.totalRepaid)).toBe(cents(input.amount) + cents(result.totalCostOfCredit));
  expect(sum((row) => row.payment) + upfront).toBe(cents(result.totalRepaid));
  expect(cents(result.amountReceived)).toBe(cents(input.amount) - upfront);
  expect(cents(result.monthlyPayment)).toBe(cents(result.schedule[0].payment));
  expect(cents(result.loanPayment)).toBe(
    cents(result.schedule[0].principal) + cents(result.schedule[0].interest),
  );
  expect(cents(result.lastPayment)).toBe(cents(result.schedule.at(-1)!.payment));
  // Every value is a whole number of cents.
  for (const value of [
    result.monthlyPayment,
    result.totalInterest,
    result.totalFees,
    result.totalCostOfCredit,
    result.totalRepaid,
    ...result.schedule.flatMap((row) => [row.payment, row.principal, row.interest, row.fees, row.balance]),
  ]) {
    expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-6);
  }
}

describe("computePersonalLoan", () => {
  it("works out the level payment, interest and totals of a loan without fees", () => {
    const result = compute();

    // 10 000 × r ÷ (1 − (1 + r)^−60) with r = 8% ÷ 12 is 202.7639…
    expect(result.months).toBe(60);
    expect(result.monthlyPayment).toBe(202.76);
    expect(result.loanPayment).toBe(202.76);
    expect(result.totalFees).toBe(0);
    expect(result.totalCostOfCredit).toBe(result.totalInterest);
    expect(result.totalInterest).toBeCloseTo(2165.83, 0);
    expectConsistent(result, base);
  });

  it("gives an APR above the nominal rate even without fees, from monthly compounding", () => {
    const result = compute();

    // (1 + 0.08 ÷ 12)^12 − 1 = 8.2999…%
    expect(result.apr).toBeCloseTo((Math.pow(1 + 0.08 / 12, 12) - 1) * 100, 2);
    expect(result.apr).toBeGreaterThan(8);
  });

  it("runs the same schedule as the mortgage calculator's engine", () => {
    const loan = compute();
    const mortgage = computeMortgage({ loanAmount: 10_000, termYears: 5, annualRate: 8, monthlyFees: 0 });
    if (!mortgage.ok) throw new Error("mortgage example invalid");

    expect(loan.loanPayment).toBe(mortgage.result.monthlyPayment);
    expect(loan.totalInterest).toBe(mortgage.result.totalInterest);
    expect(loan.schedule.map((row) => row.balance)).toEqual(
      mortgage.result.years.flatMap((year) => year.months.map((month) => month.balance)),
    );
  });

  it("adds monthly fees to each payment and to the cost of credit", () => {
    const withFees = compute({ monthlyFees: 5 });
    const without = compute();

    expect(withFees.loanPayment).toBe(without.loanPayment);
    expect(withFees.monthlyPayment).toBe(202.76 + 5);
    expect(withFees.totalMonthlyFees).toBe(300);
    expect(withFees.totalFees).toBe(300);
    expect(withFees.totalInterest).toBe(without.totalInterest);
    expect(withFees.apr).toBeGreaterThan(without.apr);
    expectConsistent(withFees, { ...base, monthlyFees: 5 });
  });

  it("takes upfront fees from the amount received, so they raise the APR", () => {
    const input = { ...base, upfrontFees: 250 };
    const result = compute(input);

    expect(result.amountReceived).toBe(9750);
    expect(result.totalFees).toBe(250);
    expect(result.monthlyPayment).toBe(202.76);
    expect(result.apr).toBeGreaterThan(compute().apr);
    expectConsistent(result, input);
  });

  it("returns the rate at which the cash flows balance", () => {
    for (const input of [
      { ...base, upfrontFees: 250, monthlyFees: 5 },
      { ...base, amount: 3000, termMonths: 6, annualRate: 12.5, upfrontFees: 60, monthlyFees: 2.5 },
      { ...base, amount: 25_000, termMonths: 120, annualRate: 6.9, upfrontFees: 400, monthlyFees: 12 },
    ]) {
      const result = compute(input);
      expect(Math.abs(presentValue(result, result.apr))).toBeLessThan(1e-6);
    }
  });

  it("is 0% with a 0% rate and no fees", () => {
    const input = { ...base, amount: 1200, termMonths: 12, annualRate: 0 };
    const result = compute(input);

    expect(result.monthlyPayment).toBe(100);
    expect(result.totalInterest).toBe(0);
    expect(result.totalCostOfCredit).toBe(0);
    expect(result.totalRepaid).toBe(1200);
    expect(result.apr).toBe(0);
    expectConsistent(result, input);
  });

  it("works the APR from the fees alone at a 0% rate", () => {
    const input = { ...base, amount: 1200, termMonths: 12, annualRate: 0, upfrontFees: 24, monthlyFees: 1 };
    const result = compute(input);

    expect(result.totalInterest).toBe(0);
    expect(result.monthlyPayment).toBe(101);
    expect(result.totalCostOfCredit).toBe(36);
    expect(result.apr).toBeGreaterThan(5);
    expect(result.apr).toBeLessThan(7);
    expect(Math.abs(presentValue(result, result.apr))).toBeLessThan(1e-6);
    expectConsistent(result, input);
  });

  it("keeps totals consistent when the fees cost more than the interest", () => {
    const input = { ...base, amount: 1000, termMonths: 12, annualRate: 1, upfrontFees: 50, monthlyFees: 5 };
    const result = compute(input);

    expect(result.totalFees).toBe(110);
    expect(result.totalFees).toBeGreaterThan(result.totalInterest * 10);
    expect(result.apr).toBeGreaterThan(20);
    expect(Math.abs(presentValue(result, result.apr))).toBeLessThan(1e-6);
    expectConsistent(result, input);
  });

  it.each([6, 120])("accepts a %d-month term", (termMonths) => {
    const input = { ...base, termMonths, upfrontFees: 100, monthlyFees: 3 };
    const result = compute(input);

    expect(result.months).toBe(termMonths);
    expectConsistent(result, input);
  });

  it("works the largest loan at the highest rate over the longest term to the cent", () => {
    const input = {
      amount: PERSONAL_LOAN_LIMITS.maxAmount,
      termMonths: PERSONAL_LOAN_LIMITS.maxTermMonths,
      annualRate: PERSONAL_LOAN_LIMITS.maxAnnualRate,
      upfrontFees: PERSONAL_LOAN_LIMITS.maxAmount * PERSONAL_LOAN_LIMITS.maxUpfrontFeesShare,
      monthlyFees: PERSONAL_LOAN_LIMITS.maxMonthlyFees,
    };
    const result = compute(input);

    expectConsistent(result, input);
    expect(Number.isFinite(result.apr)).toBe(true);
    expect(compute({ ...input, upfrontFees: 0, monthlyFees: 0 }).apr).toBeCloseTo(
      (Math.pow(1.025, 12) - 1) * 100,
      2,
    );
  });

  it("returns a finite APR for fees out of all proportion to the loan, above the shown maximum", () => {
    const result = compute({
      amount: PERSONAL_LOAN_LIMITS.minAmount,
      termMonths: 6,
      annualRate: 0,
      monthlyFees: PERSONAL_LOAN_LIMITS.maxMonthlyFees,
    });

    expect(Number.isFinite(result.apr)).toBe(true);
    expect(result.apr).toBeGreaterThan(PERSONAL_LOAN_LIMITS.maxShownApr);
  });

  it("rounds a fractional term to whole months", () => {
    expect(compute({ termMonths: 6.4 }).months).toBe(6);
    expect(compute({ termMonths: 59.6 }).months).toBe(60);
  });
});

describe("computePersonalLoan inputs", () => {
  it("asks for the amount, term and rate when they are empty", () => {
    expect(errorsFor({ amount: Number.NaN })).toEqual({ amount: "required" });
    expect(errorsFor({ termMonths: Number.NaN })).toEqual({ termMonths: "required" });
    expect(errorsFor({ annualRate: Number.NaN })).toEqual({ annualRate: "required" });
    expect(errorsFor({ amount: 0 })).toEqual({ amount: "required" });
  });

  it("counts empty fees as none", () => {
    const empty = compute({ upfrontFees: Number.NaN, monthlyFees: Number.NaN });

    expect(empty).toEqual(compute());
    expectConsistent(empty, { ...base, upfrontFees: Number.NaN, monthlyFees: Number.NaN });
  });

  it("holds the term between 6 and 120 months", () => {
    expect(errorsFor({ termMonths: 5 })).toEqual({ termMonths: "tooSmall" });
    expect(errorsFor({ termMonths: 5.4 })).toEqual({ termMonths: "tooSmall" });
    expect(errorsFor({ termMonths: 121 })).toEqual({ termMonths: "tooLarge" });
    expect(errorsFor({ termMonths: Number.POSITIVE_INFINITY })).toEqual({ termMonths: "tooLarge" });
    expect(errorsFor({ termMonths: 6 })).toEqual({});
    expect(errorsFor({ termMonths: 120 })).toEqual({});
  });

  it("holds the amount and rate within the calculator's range", () => {
    expect(errorsFor({ amount: 99 })).toEqual({ amount: "tooSmall" });
    expect(errorsFor({ amount: PERSONAL_LOAN_LIMITS.maxAmount + 1 })).toEqual({ amount: "tooLarge" });
    expect(errorsFor({ annualRate: -1 })).toEqual({ annualRate: "negative" });
    expect(errorsFor({ annualRate: 30.01 })).toEqual({ annualRate: "tooLarge" });
    expect(errorsFor({ annualRate: 0 })).toEqual({});
  });

  it("refuses negative fees and fees out of range", () => {
    expect(errorsFor({ upfrontFees: -1 })).toEqual({ upfrontFees: "negative" });
    expect(errorsFor({ monthlyFees: -1 })).toEqual({ monthlyFees: "negative" });
    expect(errorsFor({ upfrontFees: 5000.01 })).toEqual({ upfrontFees: "tooLarge" });
    expect(errorsFor({ upfrontFees: 5000 })).toEqual({});
    expect(errorsFor({ monthlyFees: PERSONAL_LOAN_LIMITS.maxMonthlyFees + 1 })).toEqual({
      monthlyFees: "tooLarge",
    });
  });

  it("checks the upfront fees against the amount only once the amount is valid", () => {
    expect(errorsFor({ amount: Number.NaN, upfrontFees: 1_000_000 })).toEqual({ amount: "required" });
  });

  it("starts from the worked example's loan, with no fees", () => {
    expect(PERSONAL_LOAN_EXAMPLE.upfrontFees).toBe(0);
    expect(PERSONAL_LOAN_EXAMPLE.monthlyFees).toBe(0);
    expect(computePersonalLoan(PERSONAL_LOAN_EXAMPLE).ok).toBe(true);
  });
});

describe("annualPercentageRate", () => {
  it("is 0 when the payments only give back what was received", () => {
    expect(annualPercentageRate(120_000, Array(12).fill(10_000))).toBe(0);
  });

  it("matches the effective annual rate of a level monthly rate", () => {
    // 1 000 received, 12 payments of the level payment at 1% a month.
    const i = 0.01;
    const payment = (100_000 * i) / (1 - Math.pow(1 + i, -12));
    expect(annualPercentageRate(100_000, Array(12).fill(payment))).toBeCloseTo(
      (Math.pow(1.01, 12) - 1) * 100,
      8,
    );
  });
});

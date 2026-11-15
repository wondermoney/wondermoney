import { describe, expect, it } from "vitest";
import { MORTGAGE_EXAMPLE, MORTGAGE_LIMITS, computeMortgage, type MortgageInput } from "./mortgage";

const base: MortgageInput = {
  loanAmount: 200_000,
  termYears: 30,
  annualRate: 3.5,
  monthlyFees: 0,
};

function calculate(overrides: Partial<MortgageInput> = {}) {
  const calculation = computeMortgage({ ...base, ...overrides });
  if (!calculation.ok) {
    throw new Error(`expected a result, got ${JSON.stringify(calculation.errors)}`);
  }
  return calculation.result;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

describe("computeMortgage", () => {
  it("computes the level monthly payment of a fixed-rate loan", () => {
    const result = calculate();

    // 200,000 at 3.5%/12 over 360 months: 200000 * r / (1 - (1 + r)^-360)
    expect(result.monthlyPayment).toBe(898.09);
    expect(result.monthlyTotal).toBe(898.09);
    expect(result.numberOfPayments).toBe(360);
  });

  it("pays the loan off exactly and keeps the totals consistent with the schedule", () => {
    const result = calculate();

    expect(result.years).toHaveLength(30);
    expect(result.years[29].balance).toBe(0);
    expect(result.totalPrincipal).toBe(200_000);

    const months = result.years.flatMap((year) => year.months);
    expect(months).toHaveLength(360);

    const interestCents = months.reduce((sum, month) => sum + toCents(month.interest), 0);
    const paidCents = months.reduce((sum, month) => sum + toCents(month.payment), 0);
    expect(toCents(result.totalInterest)).toBe(interestCents);
    expect(toCents(result.totalPaid)).toBe(paidCents);
    expect(toCents(result.totalPaid)).toBe(toCents(result.totalPrincipal) + interestCents);

    // Within cents of the unrounded formula: 898.089376 * 360 - 200000 = 123,312.18
    expect(result.totalInterest).toBe(123_312.03);
    expect(Math.abs(result.totalInterest - 123_312.18)).toBeLessThan(0.5);
  });

  it("splits the first payment into interest on the full balance and principal", () => {
    const [first] = calculate().years[0].months;

    // 200,000 * 0.035 / 12 = 583.33
    expect(first.interest).toBe(583.33);
    expect(first.principal).toBe(314.76);
    expect(first.balance).toBe(199_685.24);
  });

  it("adds yearly rows that are the sum of their months", () => {
    const [firstYear] = calculate().years;
    const months = firstYear.months;

    expect(months).toHaveLength(12);
    expect(toCents(firstYear.principal)).toBe(
      months.reduce((sum, month) => sum + toCents(month.principal), 0),
    );
    expect(toCents(firstYear.interest)).toBe(
      months.reduce((sum, month) => sum + toCents(month.interest), 0),
    );
    expect(firstYear.balance).toBe(months[11].balance);
  });

  it("adds a flat monthly cost for insurance and fees to every payment", () => {
    const result = calculate({ monthlyFees: 40 });

    expect(result.monthlyPayment).toBe(898.09);
    expect(result.monthlyTotal).toBe(938.09);
    expect(result.totalFees).toBe(14_400);
    expect(toCents(result.totalPaid)).toBe(
      toCents(result.totalPrincipal) + toCents(result.totalInterest) + toCents(result.totalFees),
    );
    expect(result.years[0].fees).toBe(480);
    expect(result.years[0].months[0].fees).toBe(40);
  });

  it("divides the amount evenly at 0% interest", () => {
    const result = calculate({ loanAmount: 120_000, termYears: 10, annualRate: 0 });

    expect(result.monthlyPayment).toBe(1000);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBe(120_000);
    expect(result.years[9].balance).toBe(0);
  });

  it("keeps payments within a cent of each other and clears the balance exactly", () => {
    const result = calculate({ loanAmount: 1000, termYears: 1, annualRate: 0 });
    const months = result.years[0].months;

    expect(result.monthlyPayment).toBe(83.33);
    for (const month of months) {
      expect(Math.abs(toCents(month.payment) - toCents(result.monthlyPayment))).toBeLessThanOrEqual(1);
    }
    expect(months[11].balance).toBe(0);
    expect(result.totalPaid).toBe(1000);
  });

  it("amortizes every month across a grid of the accepted limits", () => {
    const amounts = [MORTGAGE_LIMITS.minLoanAmount, 5_000, 10_000, 200_000, MORTGAGE_LIMITS.maxLoanAmount];
    const terms = [1, 25, 30, MORTGAGE_LIMITS.maxTermYears];
    const rates = [0, 0.001, 3.5, 20, MORTGAGE_LIMITS.maxAnnualRate];

    for (const loanAmount of amounts) {
      for (const termYears of terms) {
        for (const annualRate of rates) {
          const label = `${loanAmount} over ${termYears}y at ${annualRate}%`;
          const result = calculate({ loanAmount, termYears, annualRate });
          const months = result.years.flatMap((year) => year.months);
          const last = months[months.length - 1];

          expect(months, label).toHaveLength(termYears * 12);
          // The unrounded principal part of the first payment. When it is under a cent (a long
          // loan at a high rate) the first payments can round to interest only, as they would
          // in any schedule kept in cents; it grows every month, so the loan still amortizes.
          const monthlyRate = annualRate / 1200;
          const n = termYears * 12;
          const firstPrincipalCents =
            monthlyRate === 0
              ? (loanAmount * 100) / n
              : (loanAmount * 100 * monthlyRate) / Math.expm1(n * Math.log1p(monthlyRate));
          let previousBalance = loanAmount;
          for (const month of months.slice(0, -1)) {
            const where = `${label}, month ${month.month}`;
            if (firstPrincipalCents >= 1) expect(month.principal, where).toBeGreaterThan(0);
            else expect(month.principal, where).toBeGreaterThanOrEqual(0);
            expect(month.balance, where).toBeGreaterThan(0);
            expect(month.balance, where).toBeLessThanOrEqual(previousBalance);
            previousBalance = month.balance;
          }
          expect(last.balance, label).toBe(0);
          expect(
            Math.abs(toCents(last.payment) - toCents(result.monthlyPayment)),
            label,
          ).toBeLessThanOrEqual(1);
          expect(result.totalPrincipal, label).toBe(loanAmount);
        }
      }
    }
  });

  it("keeps long, expensive loans level instead of leaving the balance to the last month", () => {
    const cases: Array<Partial<MortgageInput>> = [
      { loanAmount: 200_000, termYears: 50, annualRate: 30 },
      { loanAmount: 10_000, termYears: 50, annualRate: 20 },
      { loanAmount: 5_000, termYears: 25, annualRate: 30 },
    ];

    for (const overrides of cases) {
      const result = calculate(overrides);
      const months = result.years.flatMap((year) => year.months);
      for (const month of months) {
        expect(
          Math.abs(toCents(month.payment) - toCents(result.monthlyPayment)),
          `${JSON.stringify(overrides)}, month ${month.month}`,
        ).toBeLessThanOrEqual(1);
      }
      expect(months.at(-1)?.balance).toBe(0);
      expect(months.at(-2)?.balance).toBeGreaterThan(0);
    }
  });

  it("never lets insurance and fees reduce the balance", () => {
    const without = calculate().years.flatMap((year) => year.months);
    const withFees = calculate({ monthlyFees: 250 }).years.flatMap((year) => year.months);

    expect(withFees.map((month) => month.balance)).toEqual(without.map((month) => month.balance));
    expect(withFees.map((month) => month.payment)).toEqual(without.map((month) => month.payment));
  });

  it("still owes more than half the loan halfway through the worked example", () => {
    const result = calculate({
      loanAmount: MORTGAGE_EXAMPLE.loanAmount,
      termYears: MORTGAGE_EXAMPLE.termYears,
      annualRate: MORTGAGE_EXAMPLE.annualRate,
      monthlyFees: MORTGAGE_EXAMPLE.monthlyFees,
    });
    const halfway = Math.floor(MORTGAGE_EXAMPLE.termYears / 2);

    expect(result.years[halfway - 1].balance).toBeGreaterThan(MORTGAGE_EXAMPLE.loanAmount / 2);
  });

  it("supports a term that is not a whole number of years", () => {
    const result = calculate({ termYears: 2.5, loanAmount: 30_000, annualRate: 0 });

    expect(result.numberOfPayments).toBe(30);
    expect(result.years).toHaveLength(3);
    expect(result.years[2].months).toHaveLength(6);
    expect(result.monthlyPayment).toBe(1000);
  });

  it("stays finite and pays off at the largest accepted inputs", () => {
    const result = calculate({
      loanAmount: MORTGAGE_LIMITS.maxLoanAmount,
      termYears: MORTGAGE_LIMITS.maxTermYears,
      annualRate: MORTGAGE_LIMITS.maxAnnualRate,
      monthlyFees: MORTGAGE_LIMITS.maxMonthlyFees,
    });

    expect(Number.isFinite(result.monthlyPayment)).toBe(true);
    expect(Number.isFinite(result.totalPaid)).toBe(true);
    expect(result.years.at(-1)?.balance).toBe(0);
    expect(result.totalPrincipal).toBe(MORTGAGE_LIMITS.maxLoanAmount);
    // At 30% a year the interest alone is 2.5% of the balance a month.
    expect(result.monthlyPayment).toBeGreaterThan(MORTGAGE_LIMITS.maxLoanAmount * 0.025);
  });

  it("handles a very low but positive rate without losing precision", () => {
    const result = calculate({ annualRate: 0.001, loanAmount: 360_000 });

    expect(result.monthlyPayment).toBeGreaterThan(1000);
    expect(result.monthlyPayment).toBeLessThan(1000.2);
    expect(result.years.at(-1)?.balance).toBe(0);
  });

  it("asks for a loan amount when it is zero, empty or negative", () => {
    for (const loanAmount of [0, -5, Number.NaN]) {
      expect(computeMortgage({ ...base, loanAmount })).toEqual({
        ok: false,
        errors: { loanAmount: "required" },
      });
    }
  });

  it("asks for at least the minimum loan amount", () => {
    expect(computeMortgage({ ...base, loanAmount: MORTGAGE_LIMITS.minLoanAmount - 0.01 })).toEqual({
      ok: false,
      errors: { loanAmount: "tooSmall" },
    });
    expect(computeMortgage({ ...base, loanAmount: 1 })).toEqual({
      ok: false,
      errors: { loanAmount: "tooSmall" },
    });
    expect(computeMortgage({ ...base, loanAmount: MORTGAGE_LIMITS.minLoanAmount }).ok).toBe(true);
  });

  it("rejects a loan amount above the limit, including infinity", () => {
    for (const loanAmount of [MORTGAGE_LIMITS.maxLoanAmount + 1, Number.POSITIVE_INFINITY]) {
      expect(computeMortgage({ ...base, loanAmount })).toEqual({
        ok: false,
        errors: { loanAmount: "tooLarge" },
      });
    }
  });

  it("asks for a term of at least one month and caps very long terms", () => {
    expect(computeMortgage({ ...base, termYears: 0 })).toEqual({
      ok: false,
      errors: { termYears: "required" },
    });
    expect(computeMortgage({ ...base, termYears: 0.01 })).toEqual({
      ok: false,
      errors: { termYears: "required" },
    });
    expect(computeMortgage({ ...base, termYears: MORTGAGE_LIMITS.maxTermYears + 1 })).toEqual({
      ok: false,
      errors: { termYears: "tooLarge" },
    });
  });

  it("rejects a negative or implausibly high rate and treats an empty rate as 0%", () => {
    expect(computeMortgage({ ...base, annualRate: -1 })).toEqual({
      ok: false,
      errors: { annualRate: "negative" },
    });
    expect(computeMortgage({ ...base, annualRate: MORTGAGE_LIMITS.maxAnnualRate + 0.1 })).toEqual({
      ok: false,
      errors: { annualRate: "tooLarge" },
    });
    expect(calculate({ annualRate: Number.NaN }).totalInterest).toBe(0);
  });

  it("rejects negative or implausibly high fees and treats empty fees as none", () => {
    expect(computeMortgage({ ...base, monthlyFees: -1 })).toEqual({
      ok: false,
      errors: { monthlyFees: "negative" },
    });
    expect(computeMortgage({ ...base, monthlyFees: MORTGAGE_LIMITS.maxMonthlyFees + 1 })).toEqual({
      ok: false,
      errors: { monthlyFees: "tooLarge" },
    });
    expect(calculate({ monthlyFees: Number.NaN }).totalFees).toBe(0);
  });

  it("reports every invalid field at once", () => {
    expect(computeMortgage({ loanAmount: 0, termYears: 0, annualRate: -1, monthlyFees: -1 })).toEqual({
      ok: false,
      errors: {
        loanAmount: "required",
        termYears: "required",
        annualRate: "negative",
        monthlyFees: "negative",
      },
    });
  });
});

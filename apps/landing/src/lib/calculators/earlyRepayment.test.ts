import { describe, expect, it } from "vitest";
import { amortizeLevelPayment, amortizeWithPayments, totalInterestCents } from "./amortization";
import {
  EARLY_REPAYMENT_EXAMPLE,
  EARLY_REPAYMENT_LIMITS,
  computeEarlyRepayment,
  type EarlyRepaymentInput,
  type EarlyRepaymentResult,
} from "./earlyRepayment";
import { computeMortgage } from "./mortgage";

const base: EarlyRepaymentInput = {
  balance: 150_000,
  termYears: 25,
  termMonths: 0,
  annualRate: 3.5,
  repayment: 20_000,
  feePercent: 0,
};

function calculate(overrides: Partial<EarlyRepaymentInput> = {}): EarlyRepaymentResult {
  const calculation = computeEarlyRepayment({ ...base, ...overrides });
  if (!calculation.ok) {
    throw new Error(`expected a result, got ${JSON.stringify(calculation.errors)}`);
  }
  return calculation.result;
}

const toCents = (value: number) => Math.round(value * 100);

/** Every figure the page shows must add up in cents. */
function expectConsistent(result: EarlyRepaymentResult, input: EarlyRepaymentInput, label = "") {
  const { original, lowerPayment, shorterTerm } = result;
  const balanceCents = toCents(input.balance);

  expect(toCents(result.repaymentApplied) + toCents(result.balanceAfter), label).toBe(balanceCents);
  expect(toCents(original.totalPaid), label).toBe(balanceCents + toCents(original.totalInterest));

  for (const scenario of [lowerPayment, shorterTerm]) {
    expect(toCents(scenario.totalPaid), label).toBe(
      toCents(result.balanceAfter) + toCents(scenario.totalInterest),
    );
    expect(toCents(scenario.interestSaved), label).toBe(
      toCents(original.totalInterest) - toCents(scenario.totalInterest),
    );
    expect(toCents(scenario.netSaving), label).toBe(
      toCents(scenario.interestSaved) - toCents(result.fee),
    );
    // Net saving is also the difference in cash out: the loan as it is, against the repayment,
    // its fee and what is left to pay.
    expect(toCents(scenario.netSaving), label).toBe(
      toCents(original.totalPaid) -
        (toCents(result.repaymentApplied) + toCents(result.fee) + toCents(scenario.totalPaid)),
    );
    expect(scenario.interestSaved, label).toBeGreaterThanOrEqual(0);
    expect(scenario.monthsSaved, label).toBe(original.months - scenario.months);
  }
}

describe("computeEarlyRepayment", () => {
  it("describes the loan as it stands with the shared mortgage engine", () => {
    const { original } = calculate();
    const mortgage = computeMortgage({ loanAmount: 150_000, termYears: 25, annualRate: 3.5, monthlyFees: 0 });
    if (!mortgage.ok) throw new Error("mortgage should compute");

    expect(original.months).toBe(300);
    expect(original.monthlyPayment).toBe(mortgage.result.monthlyPayment);
    expect(original.totalInterest).toBe(mortgage.result.totalInterest);
    expect(original.totalPaid).toBe(mortgage.result.totalPaid);
    // 150,000 at 3.5%/12 over 300 months.
    expect(original.monthlyPayment).toBe(750.94);
  });

  it("keeps the term and lowers the payment", () => {
    const result = calculate();
    const { lowerPayment, original } = result;

    expect(result.status).toBe("partial");
    expect(result.balanceAfter).toBe(130_000);
    expect(lowerPayment.months).toBe(300);
    expect(lowerPayment.monthsSaved).toBe(0);
    // 130,000 at 3.5%/12 over 300 months.
    expect(lowerPayment.monthlyPayment).toBe(650.81);
    expect(lowerPayment.paymentReduction).toBe(100.13);
    expect(toCents(lowerPayment.paymentReduction)).toBe(
      toCents(original.monthlyPayment) - toCents(lowerPayment.monthlyPayment),
    );
    expect(lowerPayment.interestSaved).toBeGreaterThan(0);
    expectConsistent(result, base);
  });

  it("keeps the payment and shortens the term", () => {
    const result = calculate();
    const { shorterTerm, lowerPayment, original } = result;

    expect(shorterTerm.monthlyPayment).toBe(original.monthlyPayment);
    expect(shorterTerm.paymentReduction).toBe(0);
    expect(shorterTerm.months).toBeLessThan(300);
    expect(shorterTerm.monthsSaved).toBeGreaterThan(0);
    expect(shorterTerm.lastPayment).toBeLessThanOrEqual(original.monthlyPayment + 0.01);
    // Paying the loan off sooner always saves more interest than lowering the payment.
    expect(shorterTerm.interestSaved).toBeGreaterThan(lowerPayment.interestSaved);
    expectConsistent(result, base);
  });

  it("pays the same amounts as the original schedule until the shorter loan is cleared", () => {
    const { shorterTerm } = calculate();
    const original = amortizeLevelPayment(15_000_000, 3.5 / 1200, 300);
    const shorter = amortizeWithPayments(
      13_000_000,
      3.5 / 1200,
      original.map((row) => row.paymentCents),
    );

    expect(shorter).toHaveLength(shorterTerm.months);
    for (const row of shorter.slice(0, -1)) {
      expect(row.paymentCents).toBe(original[row.month - 1].paymentCents);
    }
    expect(shorter.at(-1)?.balanceCents).toBe(0);
    expect(toCents(shorterTerm.totalInterest)).toBe(totalInterestCents(shorter));
  });

  it("charges the fee on the amount repaid and takes it off the saving", () => {
    const result = calculate({ feePercent: 0.5 });

    expect(result.fee).toBe(100);
    expect(toCents(result.lowerPayment.netSaving)).toBe(
      toCents(result.lowerPayment.interestSaved) - 10_000,
    );
    expectConsistent(result, { ...base, feePercent: 0.5 });
  });

  it("rounds the fee to the cent", () => {
    const result = calculate({ repayment: 1234.56, feePercent: 0.5 });

    // 1234.56 * 0.5% = 6.1728
    expect(result.fee).toBe(6.17);
  });

  it("reports a net loss when the fee costs more than the interest saved", () => {
    const result = calculate({ termYears: 0, termMonths: 2, feePercent: 5 });

    expect(result.lowerPayment.netSaving).toBeLessThan(0);
    expect(result.shorterTerm.netSaving).toBeLessThan(0);
    expectConsistent(result, { ...base, termYears: 0, termMonths: 2, feePercent: 5 });
  });

  it("leaves the loan as it is when nothing is repaid", () => {
    for (const repayment of [0, Number.NaN]) {
      const result = calculate({ repayment, feePercent: 2 });

      expect(result.status).toBe("none");
      expect(result.repaymentApplied).toBe(0);
      expect(result.fee).toBe(0);
      for (const scenario of [result.lowerPayment, result.shorterTerm]) {
        expect(scenario.months).toBe(result.original.months);
        expect(scenario.monthlyPayment).toBe(result.original.monthlyPayment);
        expect(scenario.totalInterest).toBe(result.original.totalInterest);
        expect(scenario.interestSaved).toBe(0);
        expect(scenario.netSaving).toBe(0);
      }
    }
  });

  it("clears the loan when the repayment covers the balance", () => {
    for (const repayment of [150_000, 200_000]) {
      const input = { ...base, repayment, feePercent: 1 };
      const result = calculate(input);

      expect(result.status).toBe("cleared");
      expect(result.repaymentApplied).toBe(150_000);
      expect(result.repaymentUnused).toBe(repayment - 150_000);
      expect(result.balanceAfter).toBe(0);
      // The fee is on what is repaid, not on money left over.
      expect(result.fee).toBe(1500);
      for (const scenario of [result.lowerPayment, result.shorterTerm]) {
        expect(scenario.months).toBe(0);
        expect(scenario.monthlyPayment).toBe(0);
        expect(scenario.totalInterest).toBe(0);
        expect(scenario.interestSaved).toBe(result.original.totalInterest);
        expect(scenario.monthsSaved).toBe(300);
      }
      expectConsistent(result, input);
    }
  });

  it("saves no interest at 0% but still lowers the payment or shortens the term", () => {
    const input = { ...base, balance: 120_000, termYears: 10, annualRate: 0, repayment: 30_000 };
    const result = calculate(input);

    expect(result.original.monthlyPayment).toBe(1000);
    expect(result.lowerPayment.monthlyPayment).toBe(750);
    expect(result.shorterTerm.months).toBe(90);
    expect(result.shorterTerm.monthsSaved).toBe(30);
    expect(result.lowerPayment.interestSaved).toBe(0);
    expect(result.shorterTerm.interestSaved).toBe(0);
    expectConsistent(result, input);
  });

  it("treats an empty rate as 0% and an empty fee as none", () => {
    const result = calculate({ annualRate: Number.NaN, feePercent: Number.NaN });

    expect(result.original.totalInterest).toBe(0);
    expect(result.fee).toBe(0);
  });

  it("handles one month left", () => {
    const input = { ...base, termYears: 0, termMonths: 1, repayment: 50_000 };
    const result = calculate(input);

    expect(result.original.months).toBe(1);
    // One payment of the whole balance plus a month's interest: 150,000 * 3.5% / 12 = 437.50
    expect(result.original.monthlyPayment).toBe(150_437.5);
    expect(result.lowerPayment.monthlyPayment).toBe(100_291.67);
    expect(result.shorterTerm.months).toBe(1);
    expect(result.shorterTerm.monthsSaved).toBe(0);
    expect(result.shorterTerm.lastPayment).toBe(100_291.67);
    expectConsistent(result, input);
  });

  it("adds years and months into one remaining term", () => {
    expect(calculate({ termYears: 2, termMonths: 6 }).original.months).toBe(30);
    expect(calculate({ termYears: Number.NaN, termMonths: 7 }).original.months).toBe(7);
    expect(calculate({ termYears: 3, termMonths: Number.NaN }).original.months).toBe(36);
  });

  it("keeps every figure consistent across a grid of the accepted limits", () => {
    const balances = [EARLY_REPAYMENT_LIMITS.minBalance, 10_000, 200_000, EARLY_REPAYMENT_LIMITS.maxBalance];
    const terms = [1, 13, 300, EARLY_REPAYMENT_LIMITS.maxTermYears * 12];
    const rates = [0, 0.001, 3.5, EARLY_REPAYMENT_LIMITS.maxAnnualRate];
    const shares = [0, 0.0001, 0.1, 0.5, 0.999, 1, 2];

    for (const balance of balances) {
      for (const months of terms) {
        for (const annualRate of rates) {
          for (const share of shares) {
            const input: EarlyRepaymentInput = {
              balance,
              termYears: Math.floor(months / 12),
              termMonths: months % 12,
              annualRate,
              repayment: Math.min(
                Math.round(balance * share * 100) / 100,
                EARLY_REPAYMENT_LIMITS.maxBalance,
              ),
              feePercent: 2,
            };
            const label = JSON.stringify(input);
            const result = calculate(input);

            expect(result.original.months, label).toBe(months);
            expect(result.lowerPayment.monthlyPayment, label).toBeLessThanOrEqual(
              result.original.monthlyPayment,
            );
            expect(result.shorterTerm.months, label).toBeLessThanOrEqual(months);
            expectConsistent(result, input, label);
          }
        }
      }
    }
  });

  it("never reports a negative interest saving for small repayments", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;

    for (let i = 0; i < 400; i++) {
      const months = 1 + Math.floor(random() * 600);
      const input: EarlyRepaymentInput = {
        balance: 100 + Math.floor(random() * 5_000_000),
        termYears: Math.floor(months / 12),
        termMonths: months % 12,
        annualRate: Math.round(random() * 3000) / 100,
        repayment: 0.01 + Math.floor(random() * 1000) / 100,
        feePercent: 0,
      };
      expectConsistent(calculate(input), input, JSON.stringify(input));
    }
  });

  it("stays finite at the largest accepted inputs", () => {
    const input: EarlyRepaymentInput = {
      balance: EARLY_REPAYMENT_LIMITS.maxBalance,
      termYears: EARLY_REPAYMENT_LIMITS.maxTermYears,
      termMonths: 0,
      annualRate: EARLY_REPAYMENT_LIMITS.maxAnnualRate,
      repayment: EARLY_REPAYMENT_LIMITS.maxBalance / 2,
      feePercent: EARLY_REPAYMENT_LIMITS.maxFeePercent,
    };
    const result = calculate(input);

    for (const value of [
      result.original.totalPaid,
      result.lowerPayment.totalPaid,
      result.shorterTerm.totalPaid,
      result.fee,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expectConsistent(result, input);
  });

  it("gives year-end balances for each outcome, ending at zero", () => {
    const result = calculate({ termYears: 2, termMonths: 6 });

    expect(result.original.yearEndBalances[0]).toBe(150_000);
    expect(result.original.yearEndBalances).toHaveLength(4);
    expect(result.original.yearEndBalances.at(-1)).toBe(0);
    expect(result.lowerPayment.yearEndBalances[0]).toBe(130_000);
    expect(result.shorterTerm.yearEndBalances.at(-1)).toBe(0);
    expect(calculate({ repayment: 150_000 }).shorterTerm.yearEndBalances).toEqual([0]);
  });

  it("works out the worked example the page prints", () => {
    const result = calculate({ ...EARLY_REPAYMENT_EXAMPLE });

    expect(result.status).toBe("partial");
    expect(result.shorterTerm.monthsSaved).toBeGreaterThan(12);
    expect(calculate({ ...EARLY_REPAYMENT_EXAMPLE, feePercent: EARLY_REPAYMENT_EXAMPLE.exampleFeePercent }).fee)
      .toBeGreaterThan(0);
  });

  describe("validation", () => {
    it("asks for a balance when it is zero, empty or negative", () => {
      for (const balance of [0, -5, Number.NaN]) {
        expect(computeEarlyRepayment({ ...base, balance })).toEqual({
          ok: false,
          errors: { balance: "required" },
        });
      }
    });

    it("bounds the balance", () => {
      expect(computeEarlyRepayment({ ...base, balance: 99.99 })).toEqual({
        ok: false,
        errors: { balance: "tooSmall" },
      });
      for (const balance of [EARLY_REPAYMENT_LIMITS.maxBalance + 1, Number.POSITIVE_INFINITY]) {
        expect(computeEarlyRepayment({ ...base, balance })).toEqual({
          ok: false,
          errors: { balance: "tooLarge" },
        });
      }
    });

    it("asks for at least one month and caps the term", () => {
      expect(computeEarlyRepayment({ ...base, termYears: 0, termMonths: 0 })).toEqual({
        ok: false,
        errors: { termYears: "required" },
      });
      expect(computeEarlyRepayment({ ...base, termYears: Number.NaN, termMonths: Number.NaN })).toEqual({
        ok: false,
        errors: { termYears: "required" },
      });
      expect(computeEarlyRepayment({ ...base, termYears: 50, termMonths: 1 })).toEqual({
        ok: false,
        errors: { termYears: "tooLarge" },
      });
      expect(computeEarlyRepayment({ ...base, termYears: -1 })).toEqual({
        ok: false,
        errors: { termYears: "negative" },
      });
    });

    it("keeps the months field between 0 and 11", () => {
      expect(computeEarlyRepayment({ ...base, termMonths: 12 })).toEqual({
        ok: false,
        errors: { termMonths: "tooLarge" },
      });
      expect(computeEarlyRepayment({ ...base, termMonths: -1 })).toEqual({
        ok: false,
        errors: { termMonths: "negative" },
      });
    });

    it("rejects a negative or implausibly high rate", () => {
      expect(computeEarlyRepayment({ ...base, annualRate: -0.1 })).toEqual({
        ok: false,
        errors: { annualRate: "negative" },
      });
      expect(computeEarlyRepayment({ ...base, annualRate: 30.1 })).toEqual({
        ok: false,
        errors: { annualRate: "tooLarge" },
      });
    });

    it("rejects a negative or huge repayment", () => {
      expect(computeEarlyRepayment({ ...base, repayment: -1 })).toEqual({
        ok: false,
        errors: { repayment: "negative" },
      });
      for (const repayment of [EARLY_REPAYMENT_LIMITS.maxBalance + 1, Number.POSITIVE_INFINITY]) {
        expect(computeEarlyRepayment({ ...base, repayment })).toEqual({
          ok: false,
          errors: { repayment: "tooLarge" },
        });
      }
    });

    it("rejects a negative or implausibly high fee", () => {
      expect(computeEarlyRepayment({ ...base, feePercent: -1 })).toEqual({
        ok: false,
        errors: { feePercent: "negative" },
      });
      expect(
        computeEarlyRepayment({ ...base, feePercent: EARLY_REPAYMENT_LIMITS.maxFeePercent + 0.1 }),
      ).toEqual({ ok: false, errors: { feePercent: "tooLarge" } });
    });

    it("reports every invalid field at once", () => {
      expect(
        computeEarlyRepayment({
          balance: 0,
          termYears: 0,
          termMonths: 0,
          annualRate: -1,
          repayment: -1,
          feePercent: -1,
        }),
      ).toEqual({
        ok: false,
        errors: {
          balance: "required",
          termYears: "required",
          annualRate: "negative",
          repayment: "negative",
          feePercent: "negative",
        },
      });
    });
  });
});

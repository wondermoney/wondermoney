import { describe, expect, it } from "vitest";
import {
  INTEREST_PAYOUTS,
  TERM_DEPOSIT_EXAMPLE,
  TERM_DEPOSIT_LIMITS,
  computeTermDeposit,
  paymentPeriods,
  type TermDepositInput,
} from "./termDeposit";

const base: TermDepositInput = {
  amount: 10_000,
  annualRate: 3,
  termMonths: 24,
  payout: "maturity",
  reinvest: false,
  taxRate: 0,
};

function calculate(overrides: Partial<TermDepositInput> = {}) {
  const calculation = computeTermDeposit({ ...base, ...overrides });
  if (!calculation.ok) {
    throw new Error(`expected a result, got ${JSON.stringify(calculation.errors)}`);
  }
  return calculation.result;
}

function errorsFor(overrides: Partial<TermDepositInput>) {
  const calculation = computeTermDeposit({ ...base, ...overrides });
  if (calculation.ok) throw new Error("expected input errors");
  return calculation.errors;
}

const toCents = (value: number) => Math.round(value * 100);
const sumCents = (values: number[]) => values.reduce((sum, value) => sum + toCents(value), 0);

describe("computeTermDeposit at maturity", () => {
  it("pays simple interest on the amount for the whole term in one payment", () => {
    const result = calculate();

    // 10,000 × 3% × 24 ÷ 12
    expect(result.grossInterest).toBe(600);
    expect(result.tax).toBe(0);
    expect(result.netInterest).toBe(600);
    expect(result.finalBalance).toBe(10_600);
    expect(result.reinvested).toBe(false);
    expect(result.payments).toEqual([
      {
        number: 1,
        month: 24,
        months: 24,
        grossInterest: 600,
        tax: 0,
        netInterest: 600,
        balance: 10_000,
        paidOutToDate: 600,
      },
    ]);
  });

  it("annualizes the net return with compounding", () => {
    // Two years of simple interest: 1.06^(1/2) − 1, below the 3% rate.
    expect(calculate().effectiveAnnualNetYield).toBeCloseTo(2.9563, 4);
    // Exactly one year: the yield is the rate.
    expect(calculate({ termMonths: 12 }).effectiveAnnualNetYield).toBeCloseTo(3, 10);
  });

  it("handles a one-month deposit", () => {
    const result = calculate({ termMonths: 1 });

    // 10,000 × 3% ÷ 12, and rolled over every month it would earn 1.0025^12 − 1.
    expect(result.grossInterest).toBe(25);
    expect(result.payments).toHaveLength(1);
    expect(result.effectiveAnnualNetYield).toBeCloseTo(3.0416, 4);
  });

  it("handles a 120-month deposit", () => {
    const result = calculate({ termMonths: 120 });

    expect(result.grossInterest).toBe(3_000);
    expect(result.finalBalance).toBe(13_000);
    // 1.3^(1/10) − 1
    expect(result.effectiveAnnualNetYield).toBeCloseTo(2.6584, 4);
  });

  it("ignores reinvestment, since there is a single payment", () => {
    expect(calculate({ reinvest: true })).toEqual(calculate());
  });
});

describe("computeTermDeposit with periodic payments", () => {
  it("pays the same interest each month when it is paid out", () => {
    const result = calculate({ payout: "monthly", termMonths: 12 });

    expect(result.payments).toHaveLength(12);
    for (const payment of result.payments) {
      expect(payment.grossInterest).toBe(25);
      expect(payment.balance).toBe(10_000);
    }
    expect(result.payments.map((payment) => payment.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(result.payments[11].paidOutToDate).toBe(300);
    expect(result.grossInterest).toBe(300);
    expect(result.finalBalance).toBe(10_300);
    // Each month's 25 arrives when paid: the internal rate of return is 1.0025^12 − 1.
    expect(result.effectiveAnnualNetYield).toBeCloseTo(3.0416, 4);
  });

  it("compounds at the payment frequency when interest is reinvested", () => {
    const result = calculate({ payout: "monthly", termMonths: 12, reinvest: true });

    expect(result.reinvested).toBe(true);
    expect(result.payments[0].grossInterest).toBe(25);
    expect(result.payments[0].balance).toBe(10_025);
    // The second month earns on 10,025: 25.0625, rounded to the cent.
    expect(result.payments[1].grossInterest).toBe(25.06);
    expect(result.payments[1].balance).toBe(10_050.06);
    expect(result.payments.every((payment) => payment.paidOutToDate === 0)).toBe(true);
    // Unrounded: 10,000 × (1.0025^12 − 1) = 304.16
    expect(Math.abs(result.grossInterest - 304.16)).toBeLessThanOrEqual(0.02);
    expect(result.finalBalance).toBe(result.payments[11].balance);
    expect(result.effectiveAnnualNetYield).toBeGreaterThan(3);
  });

  it("compounds quarterly and annually too", () => {
    const quarterly = calculate({ payout: "quarterly", reinvest: true });
    const annually = calculate({ payout: "annually", reinvest: true });

    expect(quarterly.payments).toHaveLength(8);
    // 10,000 × 1.0075^8 − 10,000 = 616.00
    expect(Math.abs(quarterly.grossInterest - 616.0)).toBeLessThanOrEqual(0.02);
    expect(annually.payments.map((payment) => payment.grossInterest)).toEqual([300, 309]);
    expect(annually.finalBalance).toBe(10_609);
  });

  it("pays a shorter last period pro rata at maturity", () => {
    const result = calculate({ payout: "quarterly", termMonths: 7, annualRate: 4 });

    expect(result.payments.map((payment) => [payment.month, payment.months])).toEqual([
      [3, 3],
      [6, 3],
      [7, 1],
    ]);
    // 10,000 × 4% × 3/12 twice, then × 1/12
    expect(result.payments.map((payment) => payment.grossInterest)).toEqual([100, 100, 33.33]);
    expect(result.grossInterest).toBe(233.33);
  });

  it("pays once at maturity when the term is shorter than one period", () => {
    const result = calculate({ payout: "annually", termMonths: 6 });

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toMatchObject({ month: 6, months: 6, grossInterest: 150 });
  });

  it("covers 120 monthly payments", () => {
    const result = calculate({ payout: "monthly", termMonths: 120, reinvest: true });

    expect(result.payments).toHaveLength(120);
    expect(result.payments[119].month).toBe(120);
    // Unrounded: 10,000 × (1.0025^120 − 1) = 3,493.54
    expect(Math.abs(result.grossInterest - 3_493.54)).toBeLessThanOrEqual(0.6);
  });
});

describe("computeTermDeposit net annual yield", () => {
  it("counts paid-out interest when it arrives", () => {
    const result = calculate({ termMonths: 120, payout: "annually", reinvest: false });

    // 300 at the end of every year and 10,000 back after ten: exactly 3% a year.
    expect(result.effectiveAnnualNetYield).toBeCloseTo(3, 6);
    // Paid at maturity, the same deposit yields less: 1.3^(1/10) − 1.
    expect(calculate({ termMonths: 120 }).effectiveAnnualNetYield).toBeCloseTo(2.6584, 4);
  });

  it("is net of tax for paid-out interest too", () => {
    const result = calculate({ termMonths: 36, payout: "annually", taxRate: 20 });

    // 240 net a year on 10,000: 2.4%.
    expect(result.effectiveAnnualNetYield).toBeCloseTo(2.4, 6);
  });

  it("matches the closed form when everything arrives at maturity", () => {
    for (const overrides of [
      { payout: "maturity" as const },
      { payout: "monthly" as const, reinvest: true },
      { payout: "annually" as const, termMonths: 6 },
    ]) {
      const result = calculate(overrides);
      const expected = (Math.pow(result.finalBalance / result.principal, 12 / result.termMonths) - 1) * 100;
      expect(result.effectiveAnnualNetYield).toBeCloseTo(expected, 10);
    }
  });

  it("finds the rate at the highest rate and monthly payments", () => {
    const result = calculate({ annualRate: 50, termMonths: 120, payout: "monthly" });

    // 50% ÷ 12 a month, paid when earned: (1 + 0.5 ÷ 12)^12 − 1, give or take the payments'
    // rounding to the cent (416.67 instead of 416.666…).
    expect(result.effectiveAnnualNetYield).toBeCloseTo((Math.pow(1 + 0.5 / 12, 12) - 1) * 100, 2);
  });
});

describe("computeTermDeposit tax", () => {
  it("withholds tax from each payment, rounded to the cent", () => {
    const result = calculate({ amount: 1_000, annualRate: 1, termMonths: 12, payout: "monthly", taxRate: 25 });

    // 1,000 × 1% ÷ 12 = 0.8333 → 0.83 gross; 25% of it is 0.2075 → 0.21 tax; 0.62 net.
    for (const payment of result.payments) {
      expect(payment).toMatchObject({ grossInterest: 0.83, tax: 0.21, netInterest: 0.62 });
    }
    expect(result.grossInterest).toBe(9.96);
    // The sum of the per-payment tax, not 25% of the total (2.49).
    expect(result.tax).toBe(2.52);
    expect(result.netInterest).toBe(7.44);
  });

  it("reinvests interest after tax", () => {
    const result = calculate({ payout: "annually", reinvest: true, taxRate: 20 });

    // Year 1: 300 gross, 60 tax, 240 reinvested. Year 2: 3% of 10,240 = 307.20, 61.44 tax.
    expect(result.payments[0]).toMatchObject({ grossInterest: 300, tax: 60, balance: 10_240 });
    expect(result.payments[1]).toMatchObject({ grossInterest: 307.2, tax: 61.44 });
    expect(result.finalBalance).toBe(10_485.76);
    // Net of 20% tax the deposit compounds at 2.4% a year.
    expect(result.effectiveAnnualNetYield).toBeCloseTo(2.4, 10);
  });

  it("leaves no net interest at 100% tax", () => {
    const result = calculate({ taxRate: 100, payout: "monthly" });

    expect(result.grossInterest).toBe(600);
    expect(result.tax).toBe(600);
    expect(result.netInterest).toBe(0);
    expect(result.finalBalance).toBe(10_000);
    expect(result.effectiveAnnualNetYield).toBe(0);
  });

  it("reads an empty tax field as no tax", () => {
    expect(calculate({ taxRate: Number.NaN })).toEqual(calculate({ taxRate: 0 }));
  });
});

describe("computeTermDeposit edge cases", () => {
  it("earns nothing at 0%", () => {
    const result = calculate({ annualRate: 0, payout: "quarterly" });

    expect(result.grossInterest).toBe(0);
    expect(result.netInterest).toBe(0);
    expect(result.finalBalance).toBe(10_000);
    expect(result.effectiveAnnualNetYield).toBe(0);
    expect(result.payments).toHaveLength(8);
  });

  it("rounds half a cent up instead of trusting floating point", () => {
    // 12.50 interest; 57% of it is 7.125, which floats as 7.1249… and would round down.
    const taxed = calculate({ amount: 1_000, annualRate: 2.5, termMonths: 6, taxRate: 57 });
    expect(taxed.grossInterest).toBe(12.5);
    expect(taxed.tax).toBe(7.13);
    expect(taxed.netInterest).toBe(5.37);

    // 10 × 1.45% = 0.145, which floats as 0.14499…
    expect(calculate({ amount: 10, annualRate: 1.45, termMonths: 12 }).grossInterest).toBe(0.15);
  });

  it("works in cents on fractional amounts", () => {
    const result = calculate({ amount: 1_234.567, termMonths: 12 });

    expect(result.principal).toBe(1_234.57);
    // 1,234.57 × 3% = 37.0371
    expect(result.grossInterest).toBe(37.04);
  });

  it("handles the largest amount at the highest rate over the longest term", () => {
    const result = calculate({
      amount: TERM_DEPOSIT_LIMITS.maxAmount,
      annualRate: TERM_DEPOSIT_LIMITS.maxAnnualRate,
      termMonths: TERM_DEPOSIT_LIMITS.maxTermMonths,
      payout: "monthly",
      reinvest: true,
    });

    expect(Number.isFinite(result.finalBalance)).toBe(true);
    expect(Number.isSafeInteger(toCents(result.finalBalance))).toBe(true);
    expect(result.finalBalance).toBeGreaterThan(TERM_DEPOSIT_LIMITS.maxAmount * 100);
  });

  it("asks for an amount when it is empty, zero or under a cent", () => {
    expect(errorsFor({ amount: Number.NaN }).amount).toBe("required");
    expect(errorsFor({ amount: 0 }).amount).toBe("required");
    expect(errorsFor({ amount: 0.004 }).amount).toBe("required");
    expect(computeTermDeposit({ ...base, amount: 0.01 }).ok).toBe(true);
  });

  it("rejects negative and huge amounts", () => {
    expect(errorsFor({ amount: -1 }).amount).toBe("negative");
    expect(errorsFor({ amount: TERM_DEPOSIT_LIMITS.maxAmount + 1 }).amount).toBe("tooLarge");
    expect(errorsFor({ amount: 1e30 }).amount).toBe("tooLarge");
    expect(errorsFor({ amount: Number.POSITIVE_INFINITY }).amount).toBe("tooLarge");
  });

  it("validates the rate", () => {
    expect(errorsFor({ annualRate: Number.NaN }).annualRate).toBe("required");
    expect(errorsFor({ annualRate: -0.5 }).annualRate).toBe("negative");
    expect(errorsFor({ annualRate: 50.01 }).annualRate).toBe("tooLarge");
    expect(computeTermDeposit({ ...base, annualRate: 50 }).ok).toBe(true);
  });

  it("takes a whole term of 1 to 120 months", () => {
    expect(errorsFor({ termMonths: 0 }).termMonths).toBe("required");
    expect(errorsFor({ termMonths: -3 }).termMonths).toBe("required");
    expect(errorsFor({ termMonths: Number.NaN }).termMonths).toBe("required");
    expect(errorsFor({ termMonths: 121 }).termMonths).toBe("tooLarge");
    expect(errorsFor({ termMonths: 1e12 }).termMonths).toBe("tooLarge");
    expect(errorsFor({ termMonths: 6.5 }).termMonths).toBe("notWhole");
  });

  it("takes a tax rate of 0 to 100%", () => {
    expect(errorsFor({ taxRate: -1 }).taxRate).toBe("negative");
    expect(errorsFor({ taxRate: 100.5 }).taxRate).toBe("tooLarge");
  });

  it("reports every invalid field at once", () => {
    expect(errorsFor({ amount: 0, annualRate: -1, termMonths: 0, taxRate: 101 })).toEqual({
      amount: "required",
      annualRate: "negative",
      termMonths: "required",
      taxRate: "tooLarge",
    });
  });
});

describe("computeTermDeposit invariants", () => {
  // A small deterministic generator, so a failure reproduces.
  function* cases(count: number) {
    let seed = 405;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < count; i++) {
      yield {
        amount: Math.round(next() * 500_000_00) / 100,
        annualRate: Math.round(next() * 1_000) / 100,
        termMonths: 1 + Math.floor(next() * 120),
        payout: INTEREST_PAYOUTS[Math.floor(next() * INTEREST_PAYOUTS.length)],
        reinvest: next() < 0.5,
        taxRate: Math.round(next() * 100),
      } satisfies TermDepositInput;
    }
  }

  it("adds the payment rows up to the totals exactly", () => {
    for (const input of cases(500)) {
      const calculation = computeTermDeposit(input);
      if (!calculation.ok) continue;
      const { result } = calculation;

      expect(sumCents(result.payments.map((p) => p.grossInterest))).toBe(toCents(result.grossInterest));
      expect(sumCents(result.payments.map((p) => p.tax))).toBe(toCents(result.tax));
      expect(sumCents(result.payments.map((p) => p.netInterest))).toBe(toCents(result.netInterest));
      expect(toCents(result.grossInterest) - toCents(result.tax)).toBe(toCents(result.netInterest));
      expect(toCents(result.finalBalance)).toBe(toCents(result.principal) + toCents(result.netInterest));
      expect(result.payments.reduce((sum, p) => sum + p.months, 0)).toBe(input.termMonths);

      const last = result.payments[result.payments.length - 1];
      expect(last.month).toBe(input.termMonths);
      expect(toCents(last.balance) + toCents(last.paidOutToDate)).toBe(toCents(result.finalBalance));
      expect(result.effectiveAnnualNetYield).toBeGreaterThanOrEqual(0);
    }
  });

  it("earns more when interest is reinvested than when it is paid out", () => {
    for (const input of cases(200)) {
      if (input.payout === "maturity") continue;
      const paidOut = computeTermDeposit({ ...input, reinvest: false });
      const reinvested = computeTermDeposit({ ...input, reinvest: true });
      if (!paidOut.ok || !reinvested.ok) continue;

      expect(reinvested.result.netInterest).toBeGreaterThanOrEqual(paidOut.result.netInterest);
    }
  });
});

describe("paymentPeriods", () => {
  it("splits the term into whole periods and a shorter last one", () => {
    expect(paymentPeriods(24, "maturity")).toEqual([24]);
    expect(paymentPeriods(3, "monthly")).toEqual([1, 1, 1]);
    expect(paymentPeriods(10, "quarterly")).toEqual([3, 3, 3, 1]);
    expect(paymentPeriods(30, "annually")).toEqual([12, 12, 6]);
    expect(paymentPeriods(2, "quarterly")).toEqual([2]);
  });
});

describe("TERM_DEPOSIT_EXAMPLE", () => {
  it("is a valid deposit with the 0% tax default", () => {
    expect(TERM_DEPOSIT_EXAMPLE.taxRate).toBe(0);
    expect(computeTermDeposit(TERM_DEPOSIT_EXAMPLE).ok).toBe(true);
    expect(
      computeTermDeposit({ ...TERM_DEPOSIT_EXAMPLE, payout: TERM_DEPOSIT_EXAMPLE.comparePayout, reinvest: true }).ok,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { amortizeLevelPayment, monthlyRateFromAnnual } from "./amortization";
import { computeMortgage } from "./mortgage";
import {
  MORTGAGE_TRANSFER_EXAMPLE,
  MORTGAGE_TRANSFER_LIMITS,
  computeMortgageTransfer,
  type MortgageTransferInput,
  type MortgageTransferResult,
} from "./mortgageTransfer";

const base: MortgageTransferInput = {
  balance: 150_000,
  termYears: 25,
  termMonths: 0,
  currentRate: 4.2,
  currentMonthlyFees: 45,
  newRate: 3.3,
  newTermYears: 25,
  newTermMonths: 0,
  newMonthlyFees: 35,
  exitFeePercent: 0.5,
  newLoanFees: 500,
  valuationFee: 250,
  legalFees: 900,
};

function calculate(overrides: Partial<MortgageTransferInput> = {}): MortgageTransferResult {
  const calculation = computeMortgageTransfer({ ...base, ...overrides });
  if (!calculation.ok) {
    throw new Error(`expected a result, got ${JSON.stringify(calculation.errors)}`);
  }
  return calculation.result;
}

function errorsFor(overrides: Partial<MortgageTransferInput>) {
  const calculation = computeMortgageTransfer({ ...base, ...overrides });
  if (calculation.ok) throw new Error("expected errors");
  return calculation.errors;
}

const toCents = (value: number) => Math.round(value * 100);

/** What each loan pays out in month `month` (1-based), worked again from the engine. */
function outflowsCents(input: MortgageTransferInput) {
  const orZero = (value: number) => (Number.isNaN(value) ? 0 : value);
  const months = (years: number, extra: number) => Math.round(orZero(years) * 12 + orZero(extra));
  const balanceCents = toCents(input.balance);
  const current = amortizeLevelPayment(
    balanceCents,
    monthlyRateFromAnnual(input.currentRate),
    months(input.termYears, input.termMonths),
  );
  const offer = amortizeLevelPayment(
    balanceCents,
    monthlyRateFromAnnual(input.newRate),
    months(input.newTermYears, input.newTermMonths),
  );
  const currentFees = toCents(orZero(input.currentMonthlyFees));
  const offerFees = toCents(orZero(input.newMonthlyFees));
  const length = Math.max(current.length, offer.length);
  return Array.from({ length }, (_, index) => ({
    current: index < current.length ? current[index].paymentCents + currentFees : 0,
    offer: index < offer.length ? offer[index].paymentCents + offerFees : 0,
  }));
}

/** Every figure the page shows must add up in cents. */
function expectConsistent(result: MortgageTransferResult, input: MortgageTransferInput, label = "") {
  const { current, offer, costs } = result;
  const balanceCents = toCents(input.balance);

  for (const loan of [current, offer]) {
    expect(toCents(loan.totalPayments), label).toBe(balanceCents + toCents(loan.totalInterest));
    expect(toCents(loan.totalFees), label).toBe(toCents(loan.monthlyFees) * loan.months);
    expect(toCents(loan.monthlyTotal), label).toBe(toCents(loan.monthlyPayment) + toCents(loan.monthlyFees));
  }
  expect(toCents(current.totalCost), label).toBe(toCents(current.totalPayments) + toCents(current.totalFees));
  expect(toCents(offer.totalCost), label).toBe(
    toCents(offer.totalPayments) + toCents(offer.totalFees) + toCents(costs.total),
  );
  expect(toCents(costs.total), label).toBe(
    toCents(costs.exitFee) + toCents(costs.newLoanFees) + toCents(costs.valuationFee) + toCents(costs.legalFees),
  );

  expect(toCents(result.monthlySaving), label).toBe(toCents(current.monthlyTotal) - toCents(offer.monthlyTotal));
  expect(toCents(result.netSaving), label).toBe(toCents(current.totalCost) - toCents(offer.totalCost));
  expect(toCents(result.interestSaved), label).toBe(toCents(current.totalInterest) - toCents(offer.totalInterest));

  // The year-by-year table adds up to the totals.
  const yearSavings = result.years.reduce((total, year) => total + toCents(year.saving), 0);
  const last = result.years.at(-1);
  expect(last, label).toBeDefined();
  expect(yearSavings, label).toBe(toCents(last!.cumulativeSaving));
  expect(toCents(last!.cumulativeSaving) - toCents(costs.total), label).toBe(toCents(result.netSaving));
  expect(toCents(last!.afterCosts), label).toBe(toCents(result.netSaving));
  for (const year of result.years) {
    expect(toCents(year.afterCosts), label).toBe(toCents(year.cumulativeSaving) - toCents(costs.total));
  }
  expect(result.years.length, label).toBe(Math.ceil(Math.max(current.months, offer.months) / 12));

  // The chart starts at nothing saved and ends at the table's last figure.
  expect(result.points[0], label).toEqual({ month: 0, cumulativeSaving: 0 });
  expect(result.points.at(-1)?.month, label).toBe(Math.max(current.months, offer.months));
  expect(toCents(result.points.at(-1)!.cumulativeSaving), label).toBe(toCents(last!.cumulativeSaving));
}

describe("computeMortgageTransfer", () => {
  it("works out both loans with the mortgage calculator's engine", () => {
    const result = calculate();
    const current = computeMortgage({ loanAmount: 150_000, termYears: 25, annualRate: 4.2, monthlyFees: 45 });
    const offer = computeMortgage({ loanAmount: 150_000, termYears: 25, annualRate: 3.3, monthlyFees: 35 });
    if (!current.ok || !offer.ok) throw new Error("mortgage should compute");

    expect(result.current.months).toBe(300);
    expect(result.current.monthlyPayment).toBe(current.result.monthlyPayment);
    expect(result.current.monthlyTotal).toBe(current.result.monthlyTotal);
    expect(result.current.totalInterest).toBe(current.result.totalInterest);
    expect(result.current.totalCost).toBe(current.result.totalPaid);
    expect(result.offer.monthlyPayment).toBe(offer.result.monthlyPayment);
    expect(result.offer.totalInterest).toBe(offer.result.totalInterest);
    expect(toCents(result.offer.totalCost)).toBe(toCents(offer.result.totalPaid) + toCents(result.costs.total));
    // 150,000 at 4.2%/12 and 3.3%/12 over 300 months.
    expect(result.current.monthlyPayment).toBe(808.41);
    expect(result.offer.monthlyPayment).toBe(734.94);
  });

  it("adds up the switching costs, with the exit fee as a share of the balance", () => {
    const { costs } = calculate();

    expect(costs).toEqual({
      exitFee: 750,
      newLoanFees: 500,
      valuationFee: 250,
      legalFees: 900,
      total: 2400,
    });
  });

  it("rounds the exit fee to the cent", () => {
    expect(calculate({ balance: 123_456.78, exitFeePercent: 0.5 }).costs.exitFee).toBe(617.28);
  });

  it("compares the monthly payment with insurance and fees, and the totals", () => {
    const result = calculate();

    expect(result.current.monthlyTotal).toBe(853.41);
    expect(result.offer.monthlyTotal).toBe(769.94);
    expect(result.monthlySaving).toBe(83.47);
    expect(result.netSaving).toBeGreaterThan(0);
    expectConsistent(result, base);
  });

  it("finds the first month the savings so far cover the switching costs", () => {
    const result = calculate();
    const flows = outflowsCents(base);
    const costsCents = toCents(result.costs.total);
    let cumulative = 0;
    let expected: number | null = null;
    flows.forEach((flow, index) => {
      cumulative += flow.current - flow.offer;
      if (expected === null && cumulative >= costsCents) expected = index + 1;
    });

    expect(result.breakEven).toEqual({ kind: "month", month: expected });
    // 2,400 of costs at about 83 a month: the 29th payment.
    expect(result.breakEven).toEqual({ kind: "month", month: 29 });
    const at = (month: number) =>
      flows.slice(0, month).reduce((total, flow) => total + flow.current - flow.offer, 0);
    expect(at(29)).toBeGreaterThanOrEqual(costsCents);
    expect(at(28)).toBeLessThan(costsCents);
  });

  it("puts the break-even month on the chart", () => {
    const result = calculate();
    const point = result.points.find((p) => p.month === 29);

    expect(point).toBeDefined();
    expect(toCents(point!.cumulativeSaving)).toBeGreaterThanOrEqual(toCents(result.costs.total));
  });

  it("has no break-even to wait for when switching costs nothing", () => {
    const input = { ...base, exitFeePercent: 0, newLoanFees: 0, valuationFee: 0, legalFees: 0 };
    const result = calculate(input);

    expect(result.costs.total).toBe(0);
    expect(result.breakEven).toEqual({ kind: "noCosts" });
    expectConsistent(result, input);
  });

  it("never breaks even when the costs are more than everything the switch saves", () => {
    const input = { ...base, newRate: 4.15, newMonthlyFees: 45, legalFees: 50_000 };
    const result = calculate(input);

    expect(result.monthlySaving).toBeGreaterThan(0);
    expect(result.breakEven).toEqual({ kind: "never" });
    expect(result.netSaving).toBeLessThan(0);
    expectConsistent(result, input);
  });

  it("saves nothing with the same rate, term and fees, and loses the switching costs", () => {
    const input = { ...base, newRate: 4.2, newMonthlyFees: 45 };
    const result = calculate(input);

    expect(result.monthlySaving).toBe(0);
    expect(result.interestSaved).toBe(0);
    expect(result.netSaving).toBe(-2400);
    expect(result.breakEven).toEqual({ kind: "never" });
    expect(result.longerTerm).toBeNull();
    expectConsistent(result, input);
  });

  it("is exactly even with the same loan and no costs", () => {
    const input = {
      ...base,
      newRate: 4.2,
      newMonthlyFees: 45,
      exitFeePercent: 0,
      newLoanFees: 0,
      valuationFee: 0,
      legalFees: 0,
    };
    const result = calculate(input);

    expect(result.netSaving).toBe(0);
    expect(result.breakEven).toEqual({ kind: "noCosts" });
    expectConsistent(result, input);
  });

  it("handles 0% on both loans", () => {
    const input = { ...base, currentRate: 0, newRate: 0, newTermYears: 20 };
    const result = calculate(input);

    expect(result.current.totalInterest).toBe(0);
    expect(result.offer.totalInterest).toBe(0);
    expect(result.current.monthlyPayment).toBe(500);
    expect(result.offer.monthlyPayment).toBe(625);
    expectConsistent(result, input);
  });

  it("handles a 0% offer against an interest-bearing loan", () => {
    const input = { ...base, newRate: 0 };
    const result = calculate(input);

    expect(result.offer.totalInterest).toBe(0);
    expect(result.interestSaved).toBe(result.current.totalInterest);
    expectConsistent(result, input);
  });

  describe("a longer new term", () => {
    const input = {
      ...base,
      newRate: 4.2,
      newTermYears: 35,
      newMonthlyFees: 45,
      exitFeePercent: 0,
      newLoanFees: 0,
      valuationFee: 0,
      legalFees: 0,
    };

    /** The same offer over the time left on the current loan. */
    function sameTermOffer(overrides: Partial<MortgageTransferInput>) {
      const sameTerm = calculate({ ...overrides, newTermYears: overrides.termYears ?? base.termYears, newTermMonths: overrides.termMonths ?? base.termMonths });
      return sameTerm.offer;
    }

    it("lowers the payment but costs more interest than the same offer over the time left", () => {
      const result = calculate(input);
      const sameTerm = sameTermOffer(input);

      expect(result.monthlySaving).toBeGreaterThan(0);
      expect(result.interestSaved).toBeLessThan(0);
      expect(result.longerTerm).toEqual({
        extraMonths: 120,
        sameTermMonthlyTotal: sameTerm.monthlyTotal,
        extraInterest: (toCents(result.offer.totalInterest) - toCents(sameTerm.totalInterest)) / 100,
      });
      expect(result.longerTerm!.extraInterest).toBeGreaterThan(0);
      expect(result.netSaving).toBeLessThan(0);
      expectConsistent(result, input);
    });

    it("counts the months after the current loan would have ended as a cost", () => {
      const result = calculate(input);
      const year26 = result.years[25];
      const flows = outflowsCents(input).slice(300, 312);

      // Year 26: the current loan is paid off, the new one still charges every month.
      expect(flows.every((flow) => flow.current === 0 && flow.offer > 0)).toBe(true);
      expect(toCents(year26.saving)).toBe(-flows.reduce((total, flow) => total + flow.offer, 0));
    });

    it("can break even early and still cost more by the end", () => {
      const withCosts = { ...input, newRate: 3.9, legalFees: 1000 };
      const result = calculate(withCosts);

      expect(result.breakEven.kind).toBe("month");
      expect(result.netSaving).toBeLessThan(0);
      expect(result.longerTerm?.extraInterest).toBeGreaterThan(0);
      expectConsistent(result, withCosts);
    });

    it("still flags the longer term when the lower rate cuts the interest overall", () => {
      const lowerRate = { ...input, newRate: 2, newTermYears: 26 };
      const result = calculate(lowerRate);

      expect(result.interestSaved).toBeGreaterThan(0);
      expect(result.longerTerm?.extraMonths).toBe(12);
      expect(result.longerTerm!.extraInterest).toBeGreaterThan(0);
      expectConsistent(result, lowerRate);
    });

    it("has no extra interest at 0%, only the extra months", () => {
      const result = calculate({ ...input, newRate: 0 });

      expect(result.longerTerm?.extraMonths).toBe(120);
      expect(result.longerTerm?.extraInterest).toBe(0);
    });
  });

  it("does not flag a shorter or equal term", () => {
    expect(calculate().longerTerm).toBeNull();
    expect(calculate({ newTermYears: 20 }).longerTerm).toBeNull();
  });

  it("counts the months after a shorter new loan ends as savings", () => {
    const input = { ...base, newTermYears: 15, legalFees: 30_000 };
    const result = calculate(input);

    // The higher payment costs more each month at first...
    expect(result.monthlySaving).toBeLessThan(0);
    // ...and after month 180 only the current loan would still be charging.
    expect(result.breakEven.kind).toBe("month");
    if (result.breakEven.kind === "month") expect(result.breakEven.month).toBeGreaterThan(180);
    expect(result.years[15].saving).toBeGreaterThan(0);
    expectConsistent(result, input);
  });

  it("takes a remaining term in years and months, rounding to whole months", () => {
    const result = calculate({ termYears: 22, termMonths: 4, newTermYears: 22, newTermMonths: 4 });
    expect(result.current.months).toBe(268);
    expect(result.offer.months).toBe(268);
    expect(calculate({ termYears: 2.51, termMonths: 0 }).current.months).toBe(30);
  });

  it("works with one month left", () => {
    const input = { ...base, termYears: 0, termMonths: 1, newTermYears: 0, newTermMonths: 1 };
    const result = calculate(input);

    expect(result.current.months).toBe(1);
    expect(result.offer.months).toBe(1);
    expect(result.points.map((point) => point.month)).toEqual([0, 1]);
    expect(result.breakEven).toEqual({ kind: "never" });
    expectConsistent(result, input);
  });

  it("stays exact at the largest values it accepts", () => {
    const input: MortgageTransferInput = {
      balance: MORTGAGE_TRANSFER_LIMITS.maxBalance,
      termYears: MORTGAGE_TRANSFER_LIMITS.maxTermYears,
      termMonths: 0,
      currentRate: MORTGAGE_TRANSFER_LIMITS.maxAnnualRate,
      currentMonthlyFees: MORTGAGE_TRANSFER_LIMITS.maxMonthlyFees,
      newRate: 1,
      newTermYears: MORTGAGE_TRANSFER_LIMITS.maxTermYears,
      newTermMonths: 0,
      newMonthlyFees: MORTGAGE_TRANSFER_LIMITS.maxMonthlyFees,
      exitFeePercent: MORTGAGE_TRANSFER_LIMITS.maxExitFeePercent,
      newLoanFees: MORTGAGE_TRANSFER_LIMITS.maxCost,
      valuationFee: MORTGAGE_TRANSFER_LIMITS.maxCost,
      legalFees: MORTGAGE_TRANSFER_LIMITS.maxCost,
    };
    const result = calculate(input);

    for (const value of [result.current.totalCost, result.offer.totalCost, result.netSaving]) {
      expect(Number.isSafeInteger(toCents(value))).toBe(true);
    }
    expectConsistent(result, input);
  });

  it.each([
    { currentRate: 1.5, newRate: 7, newTermYears: 40 },
    { currentRate: 9, newRate: 2, newTermYears: 10, termMonths: 7 },
    { balance: 100, currentRate: 30, newRate: 0.01, termYears: 50, newTermYears: 1 },
    { balance: 987_654.32, currentRate: 3.17, newRate: 3.16, newMonthlyFees: 0, currentMonthlyFees: 0 },
  ])("adds up to the cent for %o", (overrides) => {
    const input = { ...base, ...overrides };
    expectConsistent(calculate(input), input, JSON.stringify(overrides));
  });

  describe("empty fields", () => {
    it.each(["balance", "currentRate", "newRate"] as const)("asks for %s", (field) => {
      expect(errorsFor({ [field]: Number.NaN })[field]).toBe("required");
    });

    it("asks for the time left when both fields are empty, and reads one empty field as 0", () => {
      expect(errorsFor({ termYears: Number.NaN, termMonths: Number.NaN }).termYears).toBe("required");
      expect(calculate({ termMonths: Number.NaN }).current.months).toBe(300);
      expect(calculate({ termYears: Number.NaN, termMonths: 6 }).current.months).toBe(6);
    });

    it("asks for the new term when both fields are empty, and reads one empty field as 0", () => {
      expect(errorsFor({ newTermYears: Number.NaN, newTermMonths: Number.NaN }).newTermYears).toBe("required");
      expect(calculate({ newTermMonths: Number.NaN }).offer.months).toBe(300);
    });

    it.each([
      "currentMonthlyFees",
      "newMonthlyFees",
      "exitFeePercent",
      "newLoanFees",
      "valuationFee",
      "legalFees",
    ] as const)("counts an empty %s as 0", (field) => {
      expect(calculate({ [field]: Number.NaN })).toEqual(calculate({ [field]: 0 }));
    });
  });

  describe("validation", () => {
    it("rejects a balance below the minimum or above the maximum", () => {
      expect(errorsFor({ balance: 0 }).balance).toBe("required");
      expect(errorsFor({ balance: 99 }).balance).toBe("tooSmall");
      expect(errorsFor({ balance: MORTGAGE_TRANSFER_LIMITS.maxBalance + 1 }).balance).toBe("tooLarge");
    });

    it("rejects negative or too large rates", () => {
      expect(errorsFor({ currentRate: -0.1 }).currentRate).toBe("negative");
      expect(errorsFor({ newRate: -0.1 }).newRate).toBe("negative");
      expect(errorsFor({ currentRate: 30.1 }).currentRate).toBe("tooLarge");
      expect(errorsFor({ newRate: 30.1 }).newRate).toBe("tooLarge");
    });

    it("rejects terms out of range", () => {
      expect(errorsFor({ termYears: -1 }).termYears).toBe("negative");
      expect(errorsFor({ termMonths: 12 }).termMonths).toBe("tooLarge");
      expect(errorsFor({ termMonths: -1 }).termMonths).toBe("negative");
      expect(errorsFor({ termYears: 50, termMonths: 1 }).termYears).toBe("tooLarge");
      expect(errorsFor({ termYears: 0, termMonths: 0 }).termYears).toBe("required");
      expect(errorsFor({ newTermYears: -1 }).newTermYears).toBe("negative");
      expect(errorsFor({ newTermMonths: 12 }).newTermMonths).toBe("tooLarge");
      expect(errorsFor({ newTermYears: 51 }).newTermYears).toBe("tooLarge");
      expect(errorsFor({ newTermYears: 0, newTermMonths: 0 }).newTermYears).toBe("required");
      expect(errorsFor({ termYears: Number.POSITIVE_INFINITY }).termYears).toBe("tooLarge");
    });

    it("rejects negative or too large fees and costs", () => {
      for (const field of ["currentMonthlyFees", "newMonthlyFees"] as const) {
        expect(errorsFor({ [field]: -1 })[field]).toBe("negative");
        expect(errorsFor({ [field]: MORTGAGE_TRANSFER_LIMITS.maxMonthlyFees + 1 })[field]).toBe("tooLarge");
      }
      for (const field of ["newLoanFees", "valuationFee", "legalFees"] as const) {
        expect(errorsFor({ [field]: -1 })[field]).toBe("negative");
        expect(errorsFor({ [field]: MORTGAGE_TRANSFER_LIMITS.maxCost + 1 })[field]).toBe("tooLarge");
      }
      expect(errorsFor({ exitFeePercent: -0.1 }).exitFeePercent).toBe("negative");
      expect(errorsFor({ exitFeePercent: 10.1 }).exitFeePercent).toBe("tooLarge");
    });
  });

  it("starts the calculator with no switching costs and the new term equal to the time left", () => {
    expect(MORTGAGE_TRANSFER_EXAMPLE.exitFeePercent).toBe(0);
    expect(MORTGAGE_TRANSFER_EXAMPLE.newLoanFees).toBe(0);
    expect(MORTGAGE_TRANSFER_EXAMPLE.valuationFee).toBe(0);
    expect(MORTGAGE_TRANSFER_EXAMPLE.legalFees).toBe(0);
    expect(MORTGAGE_TRANSFER_EXAMPLE.newTermYears).toBe(MORTGAGE_TRANSFER_EXAMPLE.termYears);
    expect(MORTGAGE_TRANSFER_EXAMPLE.newTermMonths).toBe(MORTGAGE_TRANSFER_EXAMPLE.termMonths);
  });

  it("gives the worked example a saving, a break-even month and a longer-term contrast", () => {
    const { exampleCosts, exampleLongerTermYears, ...defaults } = MORTGAGE_TRANSFER_EXAMPLE;
    const withCosts = calculate({ ...defaults, ...exampleCosts });
    const longer = calculate({ ...defaults, ...exampleCosts, newTermYears: exampleLongerTermYears });

    expect(withCosts.monthlySaving).toBeGreaterThan(0);
    expect(withCosts.netSaving).toBeGreaterThan(0);
    expect(withCosts.breakEven.kind).toBe("month");
    expect(longer.longerTerm).not.toBeNull();
    expect(longer.monthlySaving).toBeGreaterThan(withCosts.monthlySaving);
    expect(longer.longerTerm!.extraInterest).toBeGreaterThan(0);
    expect(longer.longerTerm!.sameTermMonthlyTotal).toBe(withCosts.offer.monthlyTotal);
  });
});

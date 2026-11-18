/**
 * Moving a fixed-rate mortgage to a new lender (or new terms), compared with keeping it as it
 * is. Both loans repay the same balance, each over its own term at its own fixed rate, with flat
 * monthly insurance and fees for as long as it runs. Switching has one-off costs, paid in cash
 * on the day of the switch: an exit fee as a share of the balance, and the new loan's fees,
 * valuation and legal or registration costs.
 *
 * Both schedules come from the shared loan engine (`./amortization`, the one the mortgage
 * calculator runs), worked in whole cents so every figure adds up exactly: the net saving is the
 * current loan's total cost minus the new one's, and it is also the savings month by month,
 * summed, minus the switching costs.
 *
 * A month's saving is what the current loan would have cost that month minus what the new one
 * costs. Once a loan is paid off it costs nothing, so a longer new term turns the months after
 * the current loan would have ended into a cost, and a shorter one into a saving.
 */

import { amortizeLevelPayment, monthlyRateFromAnnual, totalInterestCents } from "./amortization";
import { remainingTerm } from "./earlyRepayment";
import { MORTGAGE_LIMITS } from "./mortgage";

export const MORTGAGE_TRANSFER_LIMITS = {
  /** Euros; the mortgage calculator's floor, so the loan tools accept the same loans. */
  minBalance: MORTGAGE_LIMITS.minLoanAmount,
  maxBalance: MORTGAGE_LIMITS.maxLoanAmount,
  maxTermYears: MORTGAGE_LIMITS.maxTermYears,
  /** Nominal annual rate, in percent. */
  maxAnnualRate: MORTGAGE_LIMITS.maxAnnualRate,
  /** Euros a month. */
  maxMonthlyFees: MORTGAGE_LIMITS.maxMonthlyFees,
  /** Percent of the balance. Legal caps are far lower; this only stops typos. */
  maxExitFeePercent: 10,
  /** Euros, for each one-off cost. */
  maxCost: MORTGAGE_LIMITS.maxLoanAmount,
} as const;

/**
 * The loan the calculator starts from. Switching costs start at nothing, since they vary by
 * country and lender; the page's worked example adds `exampleCosts`, then stretches the new
 * term to `exampleLongerTermYears`.
 */
export const MORTGAGE_TRANSFER_EXAMPLE = {
  balance: 150_000,
  termYears: 25,
  termMonths: 0,
  currentRate: 4.2,
  currentMonthlyFees: 45,
  newRate: 3.3,
  newTermYears: 25,
  newTermMonths: 0,
  newMonthlyFees: 35,
  exitFeePercent: 0,
  newLoanFees: 0,
  valuationFee: 0,
  legalFees: 0,
  exampleCosts: { exitFeePercent: 0.5, newLoanFees: 500, valuationFee: 250, legalFees: 900 },
  exampleLongerTermYears: 35,
} as const;

export type MortgageTransferInput = {
  /** Balance still owed today, in euros. Moves to the new loan as it is. */
  balance: number;
  /** Whole years left on the current loan. Empty (NaN) reads as 0. */
  termYears: number;
  /** Months left on top of the years, 0 to 11. Empty (NaN) reads as 0. */
  termMonths: number;
  /** The current loan's fixed nominal annual rate, in percent. Empty (NaN) is `required`. */
  currentRate: number;
  /** The current loan's insurance and fees, euros a month. Empty (NaN) reads as none. */
  currentMonthlyFees: number;
  /** The offer's fixed nominal annual rate, in percent. Empty (NaN) is `required`. */
  newRate: number;
  /** Whole years of the new loan. Empty (NaN) reads as 0. */
  newTermYears: number;
  /** Months of the new loan on top of the years, 0 to 11. Empty (NaN) reads as 0. */
  newTermMonths: number;
  /** The offer's insurance and fees, euros a month. Empty (NaN) reads as none. */
  newMonthlyFees: number;
  /** Exit or early repayment fee on the current loan, percent of the balance. Empty reads as 0. */
  exitFeePercent: number;
  /** The new loan's arrangement and processing fees, euros. Empty reads as none. */
  newLoanFees: number;
  /** Valuation of the home, euros. Empty reads as none. */
  valuationFee: number;
  /** Legal, notary and registration costs, euros. Empty reads as none. */
  legalFees: number;
};

export type MortgageTransferField = keyof MortgageTransferInput;

export type MortgageTransferInputError = "required" | "tooSmall" | "tooLarge" | "negative";

export type LoanOption = {
  /**
   * The first monthly payment of principal and interest. Later ones stay within a cent of it,
   * because the engine recomputes the payment each month.
   */
  monthlyPayment: number;
  monthlyFees: number;
  /** The first monthly payment plus insurance and fees. */
  monthlyTotal: number;
  /** Monthly payments left. */
  months: number;
  totalInterest: number;
  /** Principal plus interest. */
  totalPayments: number;
  /** Insurance and fees over the term. */
  totalFees: number;
  /** Payments, fees and, for the new loan, the switching costs. */
  totalCost: number;
};

export type SwitchingCosts = {
  exitFee: number;
  newLoanFees: number;
  valuationFee: number;
  legalFees: number;
  total: number;
};

export type BreakEven =
  /** Switching costs nothing, so there is nothing to earn back. */
  | { kind: "noCosts" }
  /** The first month (1-based) in which the savings so far cover the switching costs. */
  | { kind: "month"; month: number }
  /** The savings never cover the costs while either loan runs. */
  | { kind: "never" };

export type TransferYear = {
  /** 1-based year from today; the last one may be partial. */
  year: number;
  /** Current loan's cost minus the new loan's, over the year. Negative when the new one costs more. */
  saving: number;
  /** Savings since the switch, at the end of the year. */
  cumulativeSaving: number;
  /** `cumulativeSaving` minus the switching costs. */
  afterCosts: number;
};

export type TransferPoint = {
  /** Months from today. */
  month: number;
  cumulativeSaving: number;
};

export type MortgageTransferResult = {
  current: LoanOption;
  offer: LoanOption;
  costs: SwitchingCosts;
  /** Current monthly total minus the offer's; negative when the offer costs more each month. */
  monthlySaving: number;
  /** Current interest minus the offer's; negative when the offer costs more interest. */
  interestSaved: number;
  /** Current total cost minus the offer's, switching costs included. */
  netSaving: number;
  breakEven: BreakEven;
  /**
   * When the new term is longer than the time left: how much longer, and what the offer's rate
   * would cost over the time left instead, so the page can show how much of the lower payment
   * comes from paying for longer. Null otherwise.
   */
  longerTerm: {
    extraMonths: number;
    /** The offer's interest minus the same offer's over the time left. Never negative. */
    extraInterest: number;
    /** The offer's monthly total over the time left. */
    sameTermMonthlyTotal: number;
  } | null;
  /** Savings so far at the start, each year end, each loan's end and the break-even month. */
  points: TransferPoint[];
  years: TransferYear[];
};

export type MortgageTransferCalculation =
  | { ok: true; result: MortgageTransferResult }
  | { ok: false; errors: Partial<Record<MortgageTransferField, MortgageTransferInputError>> };

const orZero = (value: number) => (Number.isNaN(value) ? 0 : value);
const fromCents = (cents: number) => cents / 100;
const toCents = (euros: number) => Math.round(euros * 100);

type Errors = Partial<Record<MortgageTransferField, MortgageTransferInputError>>;

function validateTerm(
  errors: Errors,
  yearsField: "termYears" | "newTermYears",
  monthsField: "termMonths" | "newTermMonths",
  years: number,
  months: number,
) {
  if (months < 0) errors[monthsField] = "negative";
  else if (months > 11) errors[monthsField] = "tooLarge";

  if (years < 0) errors[yearsField] = "negative";
  else if (!errors[monthsField]) {
    const total = remainingTerm(years, months).months;
    if (!Number.isFinite(total) || total > MORTGAGE_TRANSFER_LIMITS.maxTermYears * 12) {
      errors[yearsField] = "tooLarge";
    } else if (total < 1) errors[yearsField] = "required";
  }
}

function validateRate(errors: Errors, field: "currentRate" | "newRate", rate: number) {
  if (Number.isNaN(rate)) errors[field] = "required";
  else if (rate < 0) errors[field] = "negative";
  else if (rate > MORTGAGE_TRANSFER_LIMITS.maxAnnualRate) errors[field] = "tooLarge";
}

function validateAmount(errors: Errors, field: MortgageTransferField, value: number, max: number) {
  if (value < 0) errors[field] = "negative";
  else if (value > max) errors[field] = "tooLarge";
}

function validate(input: MortgageTransferInput): Errors {
  const errors: Errors = {};
  const { balance } = input;

  if (Number.isNaN(balance) || balance <= 0) errors.balance = "required";
  else if (balance < MORTGAGE_TRANSFER_LIMITS.minBalance) errors.balance = "tooSmall";
  else if (balance > MORTGAGE_TRANSFER_LIMITS.maxBalance) errors.balance = "tooLarge";

  validateTerm(errors, "termYears", "termMonths", input.termYears, input.termMonths);
  validateTerm(errors, "newTermYears", "newTermMonths", input.newTermYears, input.newTermMonths);
  validateRate(errors, "currentRate", input.currentRate);
  validateRate(errors, "newRate", input.newRate);

  const { maxMonthlyFees, maxExitFeePercent, maxCost } = MORTGAGE_TRANSFER_LIMITS;
  validateAmount(errors, "currentMonthlyFees", input.currentMonthlyFees, maxMonthlyFees);
  validateAmount(errors, "newMonthlyFees", input.newMonthlyFees, maxMonthlyFees);
  validateAmount(errors, "exitFeePercent", input.exitFeePercent, maxExitFeePercent);
  validateAmount(errors, "newLoanFees", input.newLoanFees, maxCost);
  validateAmount(errors, "valuationFee", input.valuationFee, maxCost);
  validateAmount(errors, "legalFees", input.legalFees, maxCost);

  return errors;
}

/** One loan's schedule in cents: what it pays out each month, fees included. */
function schedule(balanceCents: number, annualRate: number, months: number, feesCents: number) {
  const rows = amortizeLevelPayment(balanceCents, monthlyRateFromAnnual(annualRate), months);
  const interestCents = totalInterestCents(rows);
  return {
    outflowsCents: rows.map((row) => row.paymentCents + feesCents),
    interestCents,
    option: (switchingCents: number): LoanOption => ({
      monthlyPayment: fromCents(rows[0].paymentCents),
      monthlyFees: fromCents(feesCents),
      monthlyTotal: fromCents(rows[0].paymentCents + feesCents),
      months,
      totalInterest: fromCents(interestCents),
      totalPayments: fromCents(balanceCents + interestCents),
      totalFees: fromCents(feesCents * months),
      totalCost: fromCents(balanceCents + interestCents + feesCents * months + switchingCents),
    }),
  };
}

export function computeMortgageTransfer(input: MortgageTransferInput): MortgageTransferCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const balanceCents = toCents(input.balance);
  const currentMonths = remainingTerm(input.termYears, input.termMonths).months;
  const newMonths = remainingTerm(input.newTermYears, input.newTermMonths).months;
  const newFeesCents = toCents(orZero(input.newMonthlyFees));

  const costs = {
    exitFee: Math.round((balanceCents * orZero(input.exitFeePercent)) / 100),
    newLoanFees: toCents(orZero(input.newLoanFees)),
    valuationFee: toCents(orZero(input.valuationFee)),
    legalFees: toCents(orZero(input.legalFees)),
  };
  const costsCents = costs.exitFee + costs.newLoanFees + costs.valuationFee + costs.legalFees;

  const current = schedule(
    balanceCents,
    input.currentRate,
    currentMonths,
    toCents(orZero(input.currentMonthlyFees)),
  );
  const offer = schedule(balanceCents, input.newRate, newMonths, newFeesCents);
  const currentOption = current.option(0);
  const offerOption = offer.option(costsCents);

  // Month by month, until both loans are paid off.
  const lastMonth = Math.max(currentMonths, newMonths);
  const cumulativeCents: number[] = [0];
  let breakEven: BreakEven = costsCents === 0 ? { kind: "noCosts" } : { kind: "never" };
  for (let month = 1; month <= lastMonth; month++) {
    const saving =
      (current.outflowsCents[month - 1] ?? 0) - (offer.outflowsCents[month - 1] ?? 0);
    cumulativeCents.push(cumulativeCents[month - 1] + saving);
    if (breakEven.kind === "never" && cumulativeCents[month] >= costsCents) {
      breakEven = { kind: "month", month };
    }
  }

  const years: TransferYear[] = [];
  for (let year = 1; year <= Math.ceil(lastMonth / 12); year++) {
    const end = Math.min(year * 12, lastMonth);
    const start = (year - 1) * 12;
    years.push({
      year,
      saving: fromCents(cumulativeCents[end] - cumulativeCents[start]),
      cumulativeSaving: fromCents(cumulativeCents[end]),
      afterCosts: fromCents(cumulativeCents[end] - costsCents),
    });
  }

  const pointMonths = new Set([0, currentMonths, newMonths]);
  for (let month = 12; month < lastMonth; month += 12) pointMonths.add(month);
  if (breakEven.kind === "month") pointMonths.add(breakEven.month);
  const points = [...pointMonths]
    .sort((a, b) => a - b)
    .map((month) => ({ month, cumulativeSaving: fromCents(cumulativeCents[month]) }));

  let longerTerm: MortgageTransferResult["longerTerm"] = null;
  if (newMonths > currentMonths) {
    const sameTerm = schedule(balanceCents, input.newRate, currentMonths, newFeesCents);
    longerTerm = {
      extraMonths: newMonths - currentMonths,
      extraInterest: fromCents(offer.interestCents - sameTerm.interestCents),
      sameTermMonthlyTotal: sameTerm.option(0).monthlyTotal,
    };
  }

  return {
    ok: true,
    result: {
      current: currentOption,
      offer: offerOption,
      costs: {
        exitFee: fromCents(costs.exitFee),
        newLoanFees: fromCents(costs.newLoanFees),
        valuationFee: fromCents(costs.valuationFee),
        legalFees: fromCents(costs.legalFees),
        total: fromCents(costsCents),
      },
      monthlySaving: fromCents(
        toCents(currentOption.monthlyTotal) - toCents(offerOption.monthlyTotal),
      ),
      interestSaved: fromCents(current.interestCents - offer.interestCents),
      netSaving: fromCents(cumulativeCents[lastMonth] - costsCents),
      breakEven,
      longerTerm,
      points,
      years,
    },
  };
}

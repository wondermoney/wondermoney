/**
 * A fixed-rate personal loan repaid in level monthly payments over a term in months, with the
 * fees that make up most of the difference between offers: a one-off fee at signing and a flat
 * monthly fee or insurance premium.
 *
 * The schedule comes from the shared loan engine in `./amortization` (the one the mortgage and
 * early repayment calculators run), worked in whole cents so every row adds up to the totals
 * exactly. The annual percentage rate is the annualised internal rate of return of the
 * borrower's actual cash flows: the amount less the upfront fees received at month 0, then each
 * monthly payment with its fees, a month counting as a twelfth of a year. Lenders work their
 * own figure under their country's rules, which can count other costs, so this is an estimate.
 */

import { amortizeLevelPayment, monthlyRateFromAnnual } from "./amortization";
import { MORTGAGE_LIMITS } from "./mortgage";

export const PERSONAL_LOAN_LIMITS = {
  /** Euros; the mortgage calculator's floor, so even at 0% over 120 months a payment is cents. */
  minAmount: MORTGAGE_LIMITS.minLoanAmount,
  /** Euros. Far above any personal loan; beyond it the figures stop meaning anything. */
  maxAmount: 1_000_000,
  minTermMonths: 6,
  maxTermMonths: 120,
  /** Nominal annual rate, in percent. */
  maxAnnualRate: MORTGAGE_LIMITS.maxAnnualRate,
  /** Upfront fees above this share of the amount are a typo, not a loan. */
  maxUpfrontFeesShare: 0.5,
  /** Euros a month. */
  maxMonthlyFees: 10_000,
  /** An APR above this, in percent, is shown as "more than" it rather than as a figure. */
  maxShownApr: 1000,
} as const;

/** The loan the page's worked example walks through; the calculator starts from it too. */
export const PERSONAL_LOAN_EXAMPLE = {
  amount: 10_000,
  termMonths: 60,
  annualRate: 8,
  upfrontFees: 0,
  monthlyFees: 0,
  /** The fees the example adds in its second step. */
  exampleUpfrontFees: 250,
  exampleMonthlyFees: 5,
} as const;

export type PersonalLoanInput = {
  /** Amount borrowed, in euros. Empty (NaN) is `required`. */
  amount: number;
  /** Term in months, rounded to the nearest whole month. Empty (NaN) is `required`. */
  termMonths: number;
  /** Fixed nominal annual rate in percent. Empty (NaN) is `required`: 0% is a value to enter. */
  annualRate: number;
  /** One-off fees paid at signing, in euros. Empty (NaN) reads as none. */
  upfrontFees: number;
  /** Flat fees and insurance paid with each payment, in euros. Empty (NaN) reads as none. */
  monthlyFees: number;
};

export type PersonalLoanField = keyof PersonalLoanInput;

export type PersonalLoanInputError = "required" | "tooSmall" | "tooLarge" | "negative";

export type PersonalLoanMonth = {
  /** 1-based month of the loan. */
  month: number;
  /** What is paid this month: principal, interest and the monthly fees. */
  payment: number;
  principal: number;
  interest: number;
  fees: number;
  /** Balance owed after this payment. */
  balance: number;
};

export type PersonalLoanResult = {
  /** Monthly payments. */
  months: number;
  /** The first monthly payment with its fees. Later ones stay within a cent of it. */
  monthlyPayment: number;
  /** The first monthly payment of principal and interest alone. */
  loanPayment: number;
  /** The final payment with its fees, which clears the balance. */
  lastPayment: number;
  /** The amount less the upfront fees: what the borrower has in hand at the start. */
  amountReceived: number;
  totalInterest: number;
  upfrontFees: number;
  /** Monthly fees over the whole term. */
  totalMonthlyFees: number;
  /** Upfront and monthly fees. */
  totalFees: number;
  /** Interest and every fee: what the loan costs on top of the amount. */
  totalCostOfCredit: number;
  /** Everything paid, upfront fees included: the amount plus the cost of credit. */
  totalRepaid: number;
  /** Estimated annual percentage rate, in percent, fees included. */
  apr: number;
  schedule: PersonalLoanMonth[];
};

export type PersonalLoanCalculation =
  | { ok: true; result: PersonalLoanResult }
  | { ok: false; errors: Partial<Record<PersonalLoanField, PersonalLoanInputError>> };

const LIMITS = PERSONAL_LOAN_LIMITS;
const orZero = (value: number) => (Number.isNaN(value) ? 0 : value);
const fromCents = (cents: number) => cents / 100;

/** The largest upfront fees the calculator takes for a loan of `amount` euros. */
export function maxUpfrontFees(amount: number): number {
  return amount * LIMITS.maxUpfrontFeesShare;
}

function validate(input: PersonalLoanInput): Partial<Record<PersonalLoanField, PersonalLoanInputError>> {
  const errors: Partial<Record<PersonalLoanField, PersonalLoanInputError>> = {};
  const { amount, termMonths, annualRate, upfrontFees, monthlyFees } = input;

  if (Number.isNaN(amount) || amount <= 0) errors.amount = "required";
  else if (amount < LIMITS.minAmount) errors.amount = "tooSmall";
  else if (amount > LIMITS.maxAmount) errors.amount = "tooLarge";

  const months = Math.round(termMonths);
  if (Number.isNaN(termMonths)) errors.termMonths = "required";
  else if (months < LIMITS.minTermMonths) errors.termMonths = "tooSmall";
  else if (months > LIMITS.maxTermMonths) errors.termMonths = "tooLarge";

  if (Number.isNaN(annualRate)) errors.annualRate = "required";
  else if (annualRate < 0) errors.annualRate = "negative";
  else if (annualRate > LIMITS.maxAnnualRate) errors.annualRate = "tooLarge";

  if (upfrontFees < 0) errors.upfrontFees = "negative";
  else if (!errors.amount && upfrontFees > maxUpfrontFees(amount)) errors.upfrontFees = "tooLarge";

  if (monthlyFees < 0) errors.monthlyFees = "negative";
  else if (monthlyFees > LIMITS.maxMonthlyFees) errors.monthlyFees = "tooLarge";

  return errors;
}

/**
 * The annual rate y, in percent, at which `receivedCents` at month 0 equals the payments, the
 * one in month i + 1 discounted by (1 + y)^((i + 1) ÷ 12). The payments add up to at least what
 * was received, so the rate is at least 0, and their present value falls as y rises: bisection
 * finds it.
 */
export function annualPercentageRate(receivedCents: number, paymentsCents: readonly number[]): number {
  const presentValue = (rate: number) => {
    const logGrowth = Math.log1p(rate);
    return paymentsCents.reduce(
      (sum, cents, index) => sum + cents * Math.exp((-(index + 1) / 12) * logGrowth),
      -receivedCents,
    );
  };

  if (presentValue(0) <= 0) return 0;

  let low = 0;
  let high = 1;
  while (presentValue(high) > 0) high *= 2;
  for (let i = 0; i < 300 && high - low > 1e-15 * Math.max(1, high); i++) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > 0) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 100;
}

export function computePersonalLoan(input: PersonalLoanInput): PersonalLoanCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const months = Math.round(input.termMonths);
  const principalCents = Math.round(input.amount * 100);
  const upfrontCents = Math.round(orZero(input.upfrontFees) * 100);
  const feeCents = Math.round(orZero(input.monthlyFees) * 100);

  const rows = amortizeLevelPayment(principalCents, monthlyRateFromAnnual(input.annualRate), months);
  const paymentsCents = rows.map((row) => row.paymentCents + feeCents);

  const interestCents = rows.reduce((total, row) => total + row.interestCents, 0);
  const monthlyFeesCents = feeCents * months;
  const feesCents = upfrontCents + monthlyFeesCents;
  const costCents = interestCents + feesCents;
  const receivedCents = principalCents - upfrontCents;

  return {
    ok: true,
    result: {
      months,
      monthlyPayment: fromCents(paymentsCents[0]),
      loanPayment: fromCents(rows[0].paymentCents),
      lastPayment: fromCents(paymentsCents[paymentsCents.length - 1]),
      amountReceived: fromCents(receivedCents),
      totalInterest: fromCents(interestCents),
      upfrontFees: fromCents(upfrontCents),
      totalMonthlyFees: fromCents(monthlyFeesCents),
      totalFees: fromCents(feesCents),
      totalCostOfCredit: fromCents(costCents),
      totalRepaid: fromCents(principalCents + costCents),
      apr: annualPercentageRate(receivedCents, paymentsCents),
      schedule: rows.map((row, index) => ({
        month: row.month,
        payment: fromCents(paymentsCents[index]),
        principal: fromCents(row.principalCents),
        interest: fromCents(row.interestCents),
        fees: fromCents(feeCents),
        balance: fromCents(row.balanceCents),
      })),
    },
  };
}

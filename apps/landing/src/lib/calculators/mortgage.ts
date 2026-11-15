/**
 * Fixed-rate loan with level monthly payments (French amortization), the shape of most
 * mortgages. Amounts are worked in whole cents so every row of the schedule adds up to the
 * totals exactly.
 *
 * Each month's payment is the level payment for the balance still owed over the months left,
 * rounded to the cent. Rounding one payment and holding it for the whole term would let the
 * rounding error compound at the loan rate: on a long, expensive loan the payment can round
 * down to the interest alone and leave the whole balance to the last month. Recomputing keeps
 * every payment within a cent of the next, and the last one clears the balance exactly.
 */

export const MORTGAGE_LIMITS = {
  /**
   * Euros. Small enough to block no real loan, large enough that even at 0% over the longest
   * term every payment is several cents rather than rounding to nothing.
   */
  minLoanAmount: 100,
  /** Euros. Beyond this the figures stop meaning anything for a household. */
  maxLoanAmount: 100_000_000,
  maxTermYears: 50,
  /** Nominal annual rate, in percent. */
  maxAnnualRate: 30,
  /** Euros a month. */
  maxMonthlyFees: 100_000,
} as const;

/** The loan the page's worked example walks through; the calculator starts from it too. */
export const MORTGAGE_EXAMPLE = {
  loanAmount: 200_000,
  termYears: 30,
  annualRate: 3.5,
  monthlyFees: 0,
  /** The insurance the example adds in its last step. */
  exampleMonthlyFees: 40,
} as const;

export type MortgageInput = {
  /** Amount borrowed, in euros. */
  loanAmount: number;
  /** Term in years; fractions are rounded to the nearest month. */
  termYears: number;
  /** Nominal annual interest rate in percent (3.5 means 3.5%). Empty (NaN) is `required`. */
  annualRate: number;
  /** Flat monthly insurance and fees, in euros. Empty (NaN) reads as none. */
  monthlyFees: number;
};

export type MortgageField = keyof MortgageInput;

export type MortgageInputError = "required" | "tooSmall" | "tooLarge" | "negative";

export type MortgageMonth = {
  /** 1-based month of the loan. */
  month: number;
  /** Principal and interest, without fees. */
  payment: number;
  principal: number;
  interest: number;
  fees: number;
  /** Balance owed after this payment. */
  balance: number;
};

export type MortgageYear = {
  /** 1-based year of the loan. */
  year: number;
  payment: number;
  principal: number;
  interest: number;
  fees: number;
  /** Balance owed at the end of the year. */
  balance: number;
  months: MortgageMonth[];
};

export type MortgageResult = {
  /**
   * The regular monthly payment of principal and interest: the first one. Later payments stay
   * within a cent of it.
   */
  monthlyPayment: number;
  /** The regular monthly payment plus insurance and fees. */
  monthlyTotal: number;
  numberOfPayments: number;
  totalPrincipal: number;
  totalInterest: number;
  totalFees: number;
  /** Principal, interest and fees over the whole term. */
  totalPaid: number;
  years: MortgageYear[];
};

export type MortgageCalculation =
  | { ok: true; result: MortgageResult }
  | { ok: false; errors: Partial<Record<MortgageField, MortgageInputError>> };

function validate(input: MortgageInput): Partial<Record<MortgageField, MortgageInputError>> {
  const errors: Partial<Record<MortgageField, MortgageInputError>> = {};
  const { loanAmount, termYears, annualRate, monthlyFees } = input;

  if (Number.isNaN(loanAmount) || loanAmount <= 0) errors.loanAmount = "required";
  else if (loanAmount < MORTGAGE_LIMITS.minLoanAmount) errors.loanAmount = "tooSmall";
  else if (loanAmount > MORTGAGE_LIMITS.maxLoanAmount) errors.loanAmount = "tooLarge";

  if (Number.isNaN(termYears) || Math.round(termYears * 12) < 1) errors.termYears = "required";
  else if (termYears > MORTGAGE_LIMITS.maxTermYears) errors.termYears = "tooLarge";

  if (Number.isNaN(annualRate)) errors.annualRate = "required";
  else if (annualRate < 0) errors.annualRate = "negative";
  else if (annualRate > MORTGAGE_LIMITS.maxAnnualRate) errors.annualRate = "tooLarge";

  if (monthlyFees < 0) errors.monthlyFees = "negative";
  else if (monthlyFees > MORTGAGE_LIMITS.maxMonthlyFees) errors.monthlyFees = "tooLarge";

  return errors;
}

/** The level payment, unrounded, that clears `balanceCents` over `months` payments. */
function levelPaymentCents(balanceCents: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return balanceCents / months;
  // B * r / (1 - (1 + r)^-n), with expm1/log1p so a tiny rate keeps its precision.
  const discount = -Math.expm1(-months * Math.log1p(monthlyRate));
  return (balanceCents * monthlyRate) / discount;
}

const fromCents = (cents: number) => cents / 100;

export function computeMortgage(input: MortgageInput): MortgageCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { annualRate } = input;
  const monthlyFees = Number.isNaN(input.monthlyFees) ? 0 : input.monthlyFees;

  const months = Math.round(input.termYears * 12);
  const monthlyRate = annualRate / 100 / 12;
  const principalCents = Math.round(input.loanAmount * 100);
  const feesCents = Math.round(monthlyFees * 100);

  const years: MortgageYear[] = [];
  let balanceCents = principalCents;
  let totalInterestCents = 0;

  for (let month = 1; month <= months; month++) {
    const interestCents = Math.round(balanceCents * monthlyRate);
    const monthsLeft = months - month + 1;
    const paymentCents = Math.round(levelPaymentCents(balanceCents, monthlyRate, monthsLeft));
    // On a long loan at a high rate the principal part of the first payments can be under half a
    // cent, so it rounds to nothing; recomputing next month from the same balance lets it grow
    // as it would unrounded, and the payment stays level.
    const principalPaidCents =
      monthsLeft === 1
        ? balanceCents
        : Math.min(Math.max(paymentCents - interestCents, 0), balanceCents);
    balanceCents -= principalPaidCents;
    totalInterestCents += interestCents;

    const yearIndex = Math.floor((month - 1) / 12);
    if (!years[yearIndex]) {
      years[yearIndex] = {
        year: yearIndex + 1,
        payment: 0,
        principal: 0,
        interest: 0,
        fees: 0,
        balance: 0,
        months: [],
      };
    }
    const year = years[yearIndex];
    year.months.push({
      month,
      payment: fromCents(principalPaidCents + interestCents),
      principal: fromCents(principalPaidCents),
      interest: fromCents(interestCents),
      fees: fromCents(feesCents),
      balance: fromCents(balanceCents),
    });
  }

  // Yearly rows are summed in cents from the monthly ones so they add up exactly.
  for (const year of years) {
    const sum = (pick: (month: MortgageMonth) => number) =>
      fromCents(year.months.reduce((total, month) => total + Math.round(pick(month) * 100), 0));
    year.payment = sum((month) => month.payment);
    year.principal = sum((month) => month.principal);
    year.interest = sum((month) => month.interest);
    year.fees = sum((month) => month.fees);
    year.balance = year.months[year.months.length - 1].balance;
  }

  const totalFeesCents = feesCents * months;
  const firstPaymentCents = Math.round(years[0].months[0].payment * 100);

  return {
    ok: true,
    result: {
      monthlyPayment: fromCents(firstPaymentCents),
      monthlyTotal: fromCents(firstPaymentCents + feesCents),
      numberOfPayments: months,
      totalPrincipal: fromCents(principalCents),
      totalInterest: fromCents(totalInterestCents),
      totalFees: fromCents(totalFeesCents),
      totalPaid: fromCents(principalCents + totalInterestCents + totalFeesCents),
      years,
    },
  };
}

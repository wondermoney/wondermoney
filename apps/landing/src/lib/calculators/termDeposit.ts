/**
 * Term deposit interest from a rate the visitor enters: no bank offers are stored or compared.
 *
 * The convention, which the page states:
 * - The rate is a gross nominal annual rate (TANB in Portugal). Interest for a period is the
 *   balance × rate × the period's months ÷ 12: whole months, no day count.
 * - Paid at maturity, interest is simple: amount × rate × term months ÷ 12, in one payment.
 * - Paid periodically (monthly, quarterly or annually), each period's interest is paid at its
 *   end. A term that is not a whole number of periods ends with a shorter last period, paid pro
 *   rata at maturity; a term shorter than one period is a single payment at maturity.
 * - Reinvested interest is added to the deposit after tax, so it compounds at the payment
 *   frequency. Paid-out interest leaves the deposit and earns nothing more here.
 * - Tax is withheld from each interest payment and rounded to the cent. All amounts are worked
 *   in whole cents, so the payment rows add up to the totals exactly.
 */

export const INTEREST_PAYOUTS = ["maturity", "monthly", "quarterly", "annually"] as const;

export type InterestPayout = (typeof INTEREST_PAYOUTS)[number];

/** Months in one payment period. */
export const PAYOUT_PERIOD_MONTHS: Record<Exclude<InterestPayout, "maturity">, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
};

export const TERM_DEPOSIT_LIMITS = {
  /** Euros. Beyond this the figures stop meaning anything for a household. */
  maxAmount: 100_000_000,
  /** Gross nominal annual rate, in percent. */
  maxAnnualRate: 50,
  minTermMonths: 1,
  maxTermMonths: 120,
  /** Percent of each interest payment. */
  maxTaxRate: 100,
} as const;

/** The deposit the page's worked example walks through; the calculator starts from it. */
export const TERM_DEPOSIT_EXAMPLE = {
  amount: 10_000,
  annualRate: 3,
  termMonths: 24,
  payout: "maturity",
  reinvest: false,
  taxRate: 0,
  /** The second step of the example: the same deposit paying quarterly, reinvested. */
  comparePayout: "quarterly",
  /**
   * The illustrative withholding the example's last step applies. It is not any country's
   * rate: the calculator's own default is 0%.
   */
  exampleTaxRate: 20,
} as const;

export type TermDepositInput = {
  /** Amount deposited, in euros. */
  amount: number;
  /** Gross nominal annual rate in percent (3 means 3%). */
  annualRate: number;
  /** Whole months, 1 to 120. */
  termMonths: number;
  payout: InterestPayout;
  /** Periodic payouts only: add each net payment to the deposit instead of paying it out. */
  reinvest: boolean;
  /** Percent withheld from each interest payment. Empty (NaN) reads as none. */
  taxRate: number;
};

export type TermDepositField = "amount" | "annualRate" | "termMonths" | "taxRate";

export type TermDepositInputError = "required" | "negative" | "tooLarge" | "notWhole";

export type TermDepositPayment = {
  /** 1-based payment number. */
  number: number;
  /** Month of the term the payment falls at the end of. */
  month: number;
  /** Months of interest this payment covers. */
  months: number;
  grossInterest: number;
  tax: number;
  netInterest: number;
  /** The deposit after this payment: grows when interest is reinvested. */
  balance: number;
  /** Net interest paid out to the saver so far: stays 0 when interest is reinvested. */
  paidOutToDate: number;
};

export type TermDepositResult = {
  principal: number;
  termMonths: number;
  payout: InterestPayout;
  /** True only for a periodic payout with reinvestment. */
  reinvested: boolean;
  grossInterest: number;
  tax: number;
  netInterest: number;
  /** What the saver has at maturity: the deposit plus all net interest, paid out or not. */
  finalBalance: number;
  /**
   * The net return annualized with compounding, in percent: (final ÷ principal)^(12 ÷ months) − 1.
   * Interest paid out is not assumed to earn anything after it leaves the deposit.
   */
  effectiveAnnualNetYield: number;
  payments: TermDepositPayment[];
};

export type TermDepositCalculation =
  | { ok: true; result: TermDepositResult }
  | { ok: false; errors: Partial<Record<TermDepositField, TermDepositInputError>> };

function validate(input: TermDepositInput): Partial<Record<TermDepositField, TermDepositInputError>> {
  const errors: Partial<Record<TermDepositField, TermDepositInputError>> = {};
  const { amount, annualRate, termMonths, taxRate } = input;

  if (Number.isNaN(amount)) errors.amount = "required";
  else if (amount < 0) errors.amount = "negative";
  else if (amount > TERM_DEPOSIT_LIMITS.maxAmount) errors.amount = "tooLarge";
  // Zero, or less than a cent.
  else if (Math.round(amount * 100) < 1) errors.amount = "required";

  if (Number.isNaN(annualRate)) errors.annualRate = "required";
  else if (annualRate < 0) errors.annualRate = "negative";
  else if (annualRate > TERM_DEPOSIT_LIMITS.maxAnnualRate) errors.annualRate = "tooLarge";

  if (Number.isNaN(termMonths) || termMonths < TERM_DEPOSIT_LIMITS.minTermMonths) {
    errors.termMonths = "required";
  } else if (termMonths > TERM_DEPOSIT_LIMITS.maxTermMonths) errors.termMonths = "tooLarge";
  else if (!Number.isInteger(termMonths)) errors.termMonths = "notWhole";

  if (taxRate < 0) errors.taxRate = "negative";
  else if (taxRate > TERM_DEPOSIT_LIMITS.maxTaxRate) errors.taxRate = "tooLarge";

  return errors;
}

/** The months each payment covers, in order; they add up to the term. */
export function paymentPeriods(termMonths: number, payout: InterestPayout): number[] {
  if (payout === "maturity") return [termMonths];
  const period = PAYOUT_PERIOD_MONTHS[payout];
  const periods = Array.from({ length: Math.floor(termMonths / period) }, () => period);
  const rest = termMonths % period;
  if (rest > 0) periods.push(rest);
  return periods;
}

const fromCents = (cents: number) => cents / 100;

export function computeTermDeposit(input: TermDepositInput): TermDepositCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const rate = input.annualRate / 100;
  const taxShare = Number.isNaN(input.taxRate) ? 0 : input.taxRate / 100;
  const reinvested = input.payout !== "maturity" && input.reinvest;
  const principalCents = Math.round(input.amount * 100);

  let balanceCents = principalCents;
  let paidOutCents = 0;
  let grossCents = 0;
  let taxCents = 0;
  let month = 0;

  const payments = paymentPeriods(input.termMonths, input.payout).map((months, index) => {
    month += months;
    const paymentGrossCents = Math.round((balanceCents * rate * months) / 12);
    const paymentTaxCents = Math.round(paymentGrossCents * taxShare);
    const paymentNetCents = paymentGrossCents - paymentTaxCents;

    grossCents += paymentGrossCents;
    taxCents += paymentTaxCents;
    if (reinvested) balanceCents += paymentNetCents;
    else paidOutCents += paymentNetCents;

    return {
      number: index + 1,
      month,
      months,
      grossInterest: fromCents(paymentGrossCents),
      tax: fromCents(paymentTaxCents),
      netInterest: fromCents(paymentNetCents),
      balance: fromCents(balanceCents),
      paidOutToDate: fromCents(paidOutCents),
    };
  });

  const netCents = grossCents - taxCents;
  const growth = netCents / principalCents;
  const effectiveAnnualNetYield =
    netCents === 0 ? 0 : Math.expm1((Math.log1p(growth) * 12) / input.termMonths) * 100;

  return {
    ok: true,
    result: {
      principal: fromCents(principalCents),
      termMonths: input.termMonths,
      payout: input.payout,
      reinvested,
      grossInterest: fromCents(grossCents),
      tax: fromCents(taxCents),
      netInterest: fromCents(netCents),
      finalBalance: fromCents(principalCents + netCents),
      effectiveAnnualNetYield,
      payments,
    },
  };
}

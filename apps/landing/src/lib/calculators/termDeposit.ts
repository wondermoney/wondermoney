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
 *   frequency. Paid-out interest leaves the deposit, so later interest is on the amount deposited.
 * - Tax is withheld from each interest payment and rounded to the cent. All amounts are worked
 *   in whole cents with exact integer arithmetic (half a cent rounds up), so the payment rows
 *   add up to the totals exactly.
 * - The net annual yield is the internal rate of return of the saver's net cash flows: the
 *   deposit at month 0, each net payment paid out at its month, and the deposit (with any
 *   reinvested interest) back at maturity.
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
  /** Amount deposited, in euros. NaN asks for a value. */
  amount: number;
  /** Gross nominal annual rate in percent (3 means 3%). NaN asks for a value. */
  annualRate: number;
  /** Whole months, 1 to 120. NaN asks for a value. */
  termMonths: number;
  payout: InterestPayout;
  /** Periodic payouts only: add each net payment to the deposit instead of paying it out. */
  reinvest: boolean;
  /** Percent withheld from each interest payment. NaN counts as 0%: the field is optional. */
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
  /**
   * The deposit plus all net interest. With interest paid out it is the total the saver
   * receives over the term, not a balance held at maturity.
   */
  finalBalance: number;
  /**
   * The internal rate of return of the net cash flows, as an annual rate in percent. With a
   * single inflow at maturity (paid at maturity, or reinvested) it is
   * (final ÷ principal)^(12 ÷ months) − 1.
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

/**
 * Rates are scaled to integers with this many units per percent (a millionth of a percent)
 * before multiplying, so the products are exact and half a cent rounds up, not to float noise.
 */
const PERCENT_SCALE = 1_000_000;

const toScaledPercent = (percent: number) => BigInt(Math.round(percent * PERCENT_SCALE));

/** numerator ÷ denominator for non-negative integers, rounded half up. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Interest in cents on `balanceCents` for `months` at `scaledRate`, rounded half up. */
function interestCents(balanceCents: number, scaledRate: bigint, months: number): number {
  const denominator = 12n * 100n * BigInt(PERCENT_SCALE);
  return Number(divideHalfUp(BigInt(balanceCents) * scaledRate * BigInt(months), denominator));
}

/** `scaledTax` percent of `grossCents`, rounded half up. */
function taxCents(grossCents: number, scaledTax: bigint): number {
  return Number(divideHalfUp(BigInt(grossCents) * scaledTax, 100n * BigInt(PERCENT_SCALE)));
}

type CashFlow = { month: number; cents: number };

/**
 * The annual rate y, in percent, at which −principal at month 0 plus each flow discounted by
 * (1 + y)^(month ÷ 12) sums to zero. Every flow is non-negative and they add up to at least the
 * principal, so the rate is at least 0 and the sum falls as y rises: bisection finds it.
 */
function internalRateOfReturn(principalCents: number, flows: ReadonlyArray<CashFlow>): number {
  const presentValue = (rate: number) =>
    flows.reduce((sum, flow) => sum + flow.cents * Math.pow(1 + rate, -flow.month / 12), 0) -
    principalCents;

  let low = 0;
  let high = 1;
  while (presentValue(high) > 0) high *= 2;
  for (let i = 0; i < 200 && high - low > 1e-15; i++) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > 0) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 100;
}

export function computeTermDeposit(input: TermDepositInput): TermDepositCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const scaledRate = toScaledPercent(input.annualRate);
  const scaledTax = toScaledPercent(Number.isNaN(input.taxRate) ? 0 : input.taxRate);
  const reinvested = input.payout !== "maturity" && input.reinvest;
  const principalCents = Math.round(input.amount * 100);

  let balanceCents = principalCents;
  let paidOutCents = 0;
  let grossCents = 0;
  let totalTaxCents = 0;
  let month = 0;
  const cashFlows: CashFlow[] = [];

  const payments = paymentPeriods(input.termMonths, input.payout).map((months, index) => {
    month += months;
    const paymentGrossCents = interestCents(balanceCents, scaledRate, months);
    const paymentTaxCents = taxCents(paymentGrossCents, scaledTax);
    const paymentNetCents = paymentGrossCents - paymentTaxCents;

    grossCents += paymentGrossCents;
    totalTaxCents += paymentTaxCents;
    if (reinvested) balanceCents += paymentNetCents;
    else {
      paidOutCents += paymentNetCents;
      if (month < input.termMonths) cashFlows.push({ month, cents: paymentNetCents });
    }

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

  const netCents = grossCents - totalTaxCents;
  // What comes back at maturity: the deposit, with reinvested interest or the last payment.
  const atMaturityCents = principalCents + netCents - cashFlows.reduce((sum, f) => sum + f.cents, 0);

  let effectiveAnnualNetYield: number;
  if (netCents === 0) effectiveAnnualNetYield = 0;
  else if (cashFlows.length === 0) {
    // One inflow at maturity: the closed form, exact.
    const growth = netCents / principalCents;
    effectiveAnnualNetYield = Math.expm1((Math.log1p(growth) * 12) / input.termMonths) * 100;
  } else {
    effectiveAnnualNetYield = internalRateOfReturn(principalCents, [
      ...cashFlows,
      { month: input.termMonths, cents: atMaturityCents },
    ]);
  }

  return {
    ok: true,
    result: {
      principal: fromCents(principalCents),
      termMonths: input.termMonths,
      payout: input.payout,
      reinvested,
      grossInterest: fromCents(grossCents),
      tax: fromCents(totalTaxCents),
      netInterest: fromCents(netCents),
      finalBalance: fromCents(principalCents + netCents),
      effectiveAnnualNetYield,
      payments,
    },
  };
}

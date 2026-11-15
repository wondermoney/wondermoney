/**
 * The fixed-rate loan engine the loan tools share (mortgage, early repayment). Amounts are whole
 * cents so every row of a schedule adds up to its totals exactly.
 *
 * Each month's payment is the level payment for the balance still owed over the months left,
 * rounded to the cent. Rounding one payment and holding it for the whole term would let the
 * rounding error compound at the loan rate: on a long, expensive loan the payment can round
 * down to the interest alone and leave the whole balance to the last month. Recomputing keeps
 * every payment within a cent of the next, and the last one clears the balance exactly.
 */

export type AmortizationMonth = {
  /** 1-based month of the schedule. */
  month: number;
  /** Principal plus interest paid this month, in cents. */
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  /** Balance owed after this payment, in cents. */
  balanceCents: number;
};

/** The monthly rate for a nominal annual rate in percent (3.5 means 3.5% a year). */
export function monthlyRateFromAnnual(annualRatePercent: number): number {
  return annualRatePercent / 100 / 12;
}

/** The level payment, unrounded, that clears `balanceCents` over `months` payments. */
export function levelPaymentCents(balanceCents: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return balanceCents / months;
  // B * r / (1 - (1 + r)^-n), with expm1/log1p so a tiny rate keeps its precision.
  const discount = -Math.expm1(-months * Math.log1p(monthlyRate));
  return (balanceCents * monthlyRate) / discount;
}

/**
 * Repays `principalCents` over `months` level monthly payments, recomputed each month from the
 * balance still owed. The last row's balance is always zero.
 */
export function amortizeLevelPayment(
  principalCents: number,
  monthlyRate: number,
  months: number,
): AmortizationMonth[] {
  const rows: AmortizationMonth[] = [];
  let balanceCents = principalCents;

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
    rows.push({
      month,
      paymentCents: principalPaidCents + interestCents,
      principalCents: principalPaidCents,
      interestCents,
      balanceCents,
    });
  }

  return rows;
}

/**
 * Repays `principalCents` by paying `paymentsCents[i]` in month i + 1 until the balance is gone,
 * with interest charged on the balance still owed. The month the balance would go below zero
 * pays only what is left plus its interest, and the schedule stops there. If the payments run
 * out first, the last one clears whatever is still owed.
 */
export function amortizeWithPayments(
  principalCents: number,
  monthlyRate: number,
  paymentsCents: readonly number[],
): AmortizationMonth[] {
  const rows: AmortizationMonth[] = [];
  let balanceCents = principalCents;

  for (let index = 0; index < paymentsCents.length && balanceCents > 0; index++) {
    const interestCents = Math.round(balanceCents * monthlyRate);
    const isLast = index === paymentsCents.length - 1;
    const principalPaidCents = isLast
      ? balanceCents
      : Math.min(Math.max(paymentsCents[index] - interestCents, 0), balanceCents);
    balanceCents -= principalPaidCents;
    rows.push({
      month: index + 1,
      paymentCents: principalPaidCents + interestCents,
      principalCents: principalPaidCents,
      interestCents,
      balanceCents,
    });
  }

  return rows;
}

/** The total interest of a schedule, in cents. */
export function totalInterestCents(rows: readonly AmortizationMonth[]): number {
  return rows.reduce((total, row) => total + row.interestCents, 0);
}

const MAX_MONTHS = 1200;

export interface PayoffPoint {
  balance: number;
  month: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Build a balance-over-time series for a debt payoff projection, mirroring the API's
 * amortisation (interest in basis points, fixed monthly payment). Used only for the
 * detail-page timeline chart; the authoritative payoff figures come from the API summary.
 * Returns an empty series when the payment cannot cover the monthly interest.
 */
export function buildPayoffSeries(input: {
  annualInterestRateBps: number;
  balance: number;
  monthlyPayment: number;
}): PayoffPoint[] {
  const rate = input.annualInterestRateBps / 10000 / 12;
  if (input.balance <= 0 || input.monthlyPayment <= 0) return [];
  if (input.monthlyPayment <= round2(input.balance * rate)) return [];

  const points: PayoffPoint[] = [{ balance: round2(input.balance), month: 0 }];
  let balance = input.balance;
  let month = 0;

  while (balance > 0 && month < MAX_MONTHS) {
    month += 1;
    const interest = round2(balance * rate);
    const principal = round2(Math.min(input.monthlyPayment - interest, balance));
    if (principal <= 0) return [];
    balance = round2(balance - principal);
    points.push({ balance, month });
  }

  return points;
}

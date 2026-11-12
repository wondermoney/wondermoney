/**
 * Splitting a purchase into equal installments.
 *
 * The total is counted in cents. Every installment but the last is the total divided by the count,
 * rounded down to the cent; the last one takes what is left, so the installments always sum to the
 * total exactly and the rounding lands on the last one (100 in 3 is 33.33, 33.33, 33.34).
 */
export function splitInstallmentAmounts(totalAmount: number, installmentCount: number): number[] {
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw new RangeError(`An installment count must be a positive integer, got ${installmentCount}`);
  }
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / installmentCount);
  if (baseCents < 1) throw new RangeError('Every installment must be at least one cent');
  const lastCents = totalCents - baseCents * (installmentCount - 1);
  return Array.from({ length: installmentCount }, (_, index) => (index === installmentCount - 1 ? lastCents : baseCents) / 100);
}

/** The fewest and most installments a plan can have; the API enforces the same range. */
export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 120;

/**
 * The amount of each installment of a purchase of `total` paid in `count` installments, the
 * same rule the API stores: in whole cents, every installment is floor(total / count) and the
 * last one takes the remainder, so the installments always add up to exactly the total.
 *
 * Returns an empty list when the inputs do not describe a plan (a non-positive or non-finite
 * total, or a count outside 2..120), so a form preview can show nothing rather than a guess.
 */
export function installmentAmounts(total: number, count: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  if (
    !Number.isInteger(count) ||
    count < MIN_INSTALLMENTS ||
    count > MAX_INSTALLMENTS
  ) {
    return [];
  }
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  const lastCents = totalCents - baseCents * (count - 1);
  return Array.from(
    { length: count },
    (_, index) => (index === count - 1 ? lastCents : baseCents) / 100,
  );
}

/** The regular installment and the last one, which carries the rounding remainder. */
export function installmentPreview(
  total: number,
  count: number,
): { regular: number; last: number; count: number } | null {
  const amounts = installmentAmounts(total, count);
  if (amounts.length === 0) return null;
  return { regular: amounts[0]!, last: amounts.at(-1)!, count: amounts.length };
}

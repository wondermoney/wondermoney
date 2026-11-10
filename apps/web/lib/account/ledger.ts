/**
 * Breaks for the transactions ledger: where a month and where a day starts
 * in the list. Pure, so the table cells stay presentational.
 */

/** True on the first row of each calendar month, in list order. */
export function monthBreaks(dates: Date[]): boolean[] {
  return dates.map((date, index) => {
    if (index === 0) return true;
    const previous = dates[index - 1];
    return (
      previous.getFullYear() !== date.getFullYear() ||
      previous.getMonth() !== date.getMonth()
    );
  });
}

/** True on the first row of each calendar day, in list order. */
export function dayBreaks(dates: Date[]): boolean[] {
  return dates.map((date, index) => {
    if (index === 0) return true;
    return date.toDateString() !== dates[index - 1].toDateString();
  });
}

/**
 * The merchant, when it says something the description does not. The seeded
 * data echoes the description on every row; production differs on ~42% of
 * rows (see the merchant column in AccountTransactionsTable).
 */
export function distinctMerchant(transaction: {
  description?: string | null;
  transactionMerchantKey?: { name: string } | null;
}): string | null {
  const merchant = transaction.transactionMerchantKey?.name?.trim();
  if (!merchant) return null;
  const description = transaction.description?.trim().toLowerCase();
  return description === merchant.toLowerCase() ? null : merchant;
}

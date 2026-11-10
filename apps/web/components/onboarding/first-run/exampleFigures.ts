/**
 * The made-up figures first-run shows before the user's own data has synced.
 *
 * They are numbers, not strings in the message files, so each locale formats
 * them its own way (`16.090 €` in pt, not `€16.090`), and they are one set that
 * adds up: the accounts total is what "balances" shows, and net worth is that
 * plus an investment portfolio. Every place that shows one labels it as an
 * example, because a figure on this screen otherwise reads as the user's own.
 */
export const EXAMPLE_FIGURES = {
  accountsTotal: 16090,
  budgetUsed: 0.64,
  netWorth: 42680,
  transactions: 18,
} as const;

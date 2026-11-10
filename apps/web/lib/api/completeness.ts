/**
 * Whether a total could include every row it covers. Amounts are summed in
 * the user's currency; a row with no exchange rate for its currency has no
 * amount there, so it is left out of the total and counted here instead.
 * Sent by the reports, the dashboard cash flow and the budget months.
 */
export interface AmountsCompleteness {
  currencyCode: string;
  isComplete: boolean;
  unconvertedTransactions: number;
  /** The currencies of the rows left out (dashboard and budgets). */
  unconvertedCurrencies?: string[];
}

import { z } from 'zod'

/**
 * Whether a total could include every row it covers (`completeness` on the reports, dividends and
 * account category spending). Amounts are summed in one currency; a row with no exchange rate for
 * its currency has no amount there, so the API leaves it out of the total and counts it here.
 * Every field but the currency is optional: an older server sends `{ currencyCode }` alone, which
 * reads as complete.
 */
export const amountsCompletenessSchema = z.object({
  currencyCode: z.string(),
  isComplete: z.boolean().optional(),
  unconvertedTransactions: z.number().int().nonnegative().optional(),
  /** The currencies of the rows left out, when the endpoint names them. */
  unconvertedCurrencies: z.array(z.string()).optional(),
})

export type AmountsCompleteness = z.infer<typeof amountsCompletenessSchema>

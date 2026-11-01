import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '@/lib/api/runtime-schema'

/**
 * The five-field least-privilege recent-transaction item served by
 * `GET /v1/account/:accountId/recent-transactions`. Fields outside these five are stripped,
 * so nothing extra reaches the view model. Nulls are explicit and never inferred. An entry
 * type this build doesn't know reads as 'unknown' and renders as an ordinary transaction row.
 */
const recentTransactionEntryTypeSchema = tolerantEnum([
  'persisted_transaction',
  'synthetic_initial_balance',
], 'unknown')

export const recentTransactionSchema = z
  .object({
    entryType: recentTransactionEntryTypeSchema,
    occurredAt: z.string().datetime().nullable(),
    displayName: z.string().nullable(),
    amount: z.number().finite().nullable(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  })

export const recentTransactionsResponseSchema = z.object({
  transactions: z.array(recentTransactionSchema),
})

export type RecentTransactionDto = z.infer<typeof recentTransactionSchema>

export function createRecentTransactionsEndpoint(accountId: number) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/${accountId}/recent-transactions`,
    schema: recentTransactionsResponseSchema,
  })
}

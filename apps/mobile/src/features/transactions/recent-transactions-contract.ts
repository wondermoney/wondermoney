import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'

/**
 * RAD-220 — the five-field least-privilege recent-transaction item served by
 * `GET /v1/account/:accountId/recent-transactions`. Strict: any extra/sensitive field
 * (ids, dirty descriptions, review state, logos) is a contract violation. Nulls are
 * explicit and never inferred.
 */
export const recentTransactionEntryTypeSchema = z.enum([
  'persisted_transaction',
  'synthetic_initial_balance',
])

export const recentTransactionSchema = z
  .object({
    entryType: recentTransactionEntryTypeSchema,
    occurredAt: z.string().datetime().nullable(),
    displayName: z.string().nullable(),
    amount: z.number().finite().nullable(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  })
  .strict()

export const recentTransactionsResponseSchema = z.object({
  transactions: z.array(recentTransactionSchema),
})

export type RecentTransactionEntryType = z.infer<typeof recentTransactionEntryTypeSchema>
export type RecentTransactionDto = z.infer<typeof recentTransactionSchema>
export type RecentTransactionsResponseDto = z.infer<typeof recentTransactionsResponseSchema>

export function createRecentTransactionsEndpoint(accountId: number) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/${accountId}/recent-transactions`,
    schema: recentTransactionsResponseSchema,
  })
}

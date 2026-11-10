import { z } from 'zod'

import { readEndpoint, tolerantEnum } from '@/lib/api/runtime-schema'

import { isValidBankConnectionId } from './connection-status-contract'

/**
 * `GET /v1/banking/connections/:connectionId/syncs`: the last 20 attempts for
 * one connection, newest first. `result` and `errorCode` are null while a run is
 * still going; `retryAt` is set only for a rate-limited run that has a next
 * attempt time.
 *
 * Not `.strict()`, like the other response contracts: an additive API field must
 * not fail every run in the list.
 */
export const bankSyncHistoryRunSchema = z.object({
  accounts: z.number().int().nonnegative().nullable(),
  errorCode: z.string().min(1).nullable(),
  finishedAt: z.string().datetime().nullable(),
  flow: tolerantEnum(['initial-add', 'scheduled-refresh'], null).nullable(),
  result: tolerantEnum(['failed', 'full_success', 'partial'], null).nullable(),
  retryAt: z.string().datetime().nullable(),
  rowsCreated: z.number().int().nonnegative().nullable(),
  startedAt: z.string().datetime(),
})

export const bankSyncHistoryResponseSchema = z.object({
  syncs: z.array(bankSyncHistoryRunSchema),
})

export type BankSyncHistoryRunDto = z.infer<typeof bankSyncHistoryRunSchema>
export type BankSyncHistoryResponseDto = z.infer<typeof bankSyncHistoryResponseSchema>

export function createBankSyncHistoryEndpoint(connectionId: number) {
  if (!isValidBankConnectionId(connectionId)) throw new Error('A positive safe connection id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/banking/connections/${connectionId}/syncs`,
    schema: bankSyncHistoryResponseSchema,
  })
}

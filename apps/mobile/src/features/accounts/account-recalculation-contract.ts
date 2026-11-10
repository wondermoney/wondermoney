import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

import { isValidAccountId } from './accounts-contract'

/**
 * `POST /v1/account/:accountId/recalculate` and the `account.recalculate` background operation it
 * starts (the API's `account-recalculation.service.ts`). Web follows the same operation
 * (`components/account/AccountRecalculateDialog.tsx`).
 */
const startResponseSchema = z.object({ operationId: z.string().min(1) })

export function createStartAccountRecalculationEndpoint(accountId: number) {
  if (!isValidAccountId(accountId)) throw new Error('A positive safe account id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/recalculate`,
    schema: startResponseSchema,
  })
}

const operationResponseSchema = z.object({
  progress: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.string().min(1),
})

export function createAccountRecalculationOperationEndpoint(operationId: string) {
  const normalized = operationId.trim()
  if (!normalized) throw new Error('A non-empty operation id is required.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/operations/${encodeURIComponent(normalized)}`,
    schema: operationResponseSchema,
  })
}

export const TERMINAL_OPERATION_STATUSES = ['succeeded', 'partial', 'failed', 'needs_action', 'stale'] as const

export const isTerminalOperationStatus = (status: string): boolean => (TERMINAL_OPERATION_STATUSES as readonly string[]).includes(status)

/** What a finished run changed: how many rows it corrected and the balance before and after, in the account's currency. */
export type AccountRecalculationResult = Readonly<{
  rowsChanged: number
  balanceBefore: number | null
  balanceAfter: number | null
  currency: string
}>

const resultSchema = z.object({
  balanceAfter: z.number().nullable(),
  balanceBefore: z.number().nullable(),
  currency: z.string().min(1),
  rowsChanged: z.number().int().nonnegative(),
})

export function readAccountRecalculationResult(progress: Record<string, unknown> | null | undefined): AccountRecalculationResult | null {
  const parsed = resultSchema.safeParse(progress)
  return parsed.success ? parsed.data : null
}

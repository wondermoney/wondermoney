import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

const positiveId = z.number().int().positive().safe()
const name = z.string().trim().min(1).max(120)
const text = (max: number) => z.string().max(max).nullable()

/** Which way the money moves; the add form maps it to Expense or Income. */
export type TransactionTemplateDirection = 'in' | 'out'

/**
 * A saved manual entry, as `/v1/transaction-template` returns it. Templates are private to the
 * member who created them: the API only ever returns the caller's own.
 */
export const transactionTemplateSchema = z.object({
  transactionTemplateKey: positiveId,
  name,
  direction: z.enum(['in', 'out']),
  amount: z.number().positive().nullable(),
  description: text(500),
  notes: text(1000),
  position: z.number().int().nonnegative(),
  account: z.object({ accountKey: positiveId, accountName: z.string().nullable() }).nullable(),
  category: z.object({ categoryKey: positiveId, name: z.string() }).nullable(),
  transactionMerchant: z.object({ transactionMerchantKey: positiveId, name: z.string() }).nullable(),
})

export type TransactionTemplateDto = z.infer<typeof transactionTemplateSchema>

export const transactionTemplatesResponseSchema = z.object({ templates: z.array(transactionTemplateSchema) })

export const transactionTemplatesEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/transaction-template',
  schema: transactionTemplatesResponseSchema,
})

export type TransactionTemplateInput = Readonly<{
  name: string
  direction: TransactionTemplateDirection
  amount?: number | null
  description?: string | null
  notes?: string | null
}>

export const createTransactionTemplateEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/transaction-template',
  schema: z.object({ template: transactionTemplateSchema }),
  successStatuses: [201],
})

export function updateTransactionTemplateEndpoint(transactionTemplateId: number) {
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/transaction-template/${positiveId.parse(transactionTemplateId)}`,
    schema: z.object({ template: transactionTemplateSchema }),
  })
}

export function deleteTransactionTemplateEndpoint(transactionTemplateId: number) {
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/transaction-template/${positiveId.parse(transactionTemplateId)}`,
    schema: z.undefined(),
    successStatuses: [204],
  })
}

/** The fields the editor sends, trimmed and with a positive amount or none. */
export function freezeTemplateInput(input: TransactionTemplateInput): TransactionTemplateInput {
  const trimmedName = name.parse(input.name)
  const amount = input.amount ?? null
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) throw new Error('Amount must be greater than zero.')
  return Object.freeze({
    name: trimmedName,
    direction: input.direction,
    amount,
    description: input.description?.trim() || null,
    notes: input.notes?.trim() || null,
  })
}

import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

const positiveId = z.number().int().positive().safe()
const boundedName = z.string().trim().min(1).max(200)
const currencyCode = z.string().regex(/^[A-Z]{3}$/)

export const transactionTypeSchema = z.object({
  transactionTypeKey: positiveId,
  name: z.string().trim().min(1).max(100),
}).strict()

export const transactionTypesResponseSchema = z.object({
  transactionTypes: z.array(transactionTypeSchema),
}).strict()

export const settlementCurrencySchema = z.object({
  currencyKey: positiveId,
  code: currencyCode,
  description: z.string().max(255).nullish(),
}).strict()

export const settlementCurrenciesResponseSchema = z.object({
  currencies: z.array(settlementCurrencySchema),
}).strict()

export const transactionMerchantSchema = z.object({
  transactionMerchantKey: positiveId,
  name: boundedName,
}).strict()

export const transactionMerchantsResponseSchema = z.object({
  transactionMerchants: z.array(transactionMerchantSchema),
}).strict()

export type TransactionTypeDto = z.infer<typeof transactionTypeSchema>
export type SettlementCurrencyDto = z.infer<typeof settlementCurrencySchema>
export type TransactionMerchantDto = z.infer<typeof transactionMerchantSchema>

export const transactionTypesEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account/transaction-types',
  schema: transactionTypesResponseSchema,
})

export const settlementCurrenciesEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account/currencies',
  schema: settlementCurrenciesResponseSchema,
})

export function createTransactionMerchantsEndpoint(search: string, limit = 20) {
  const normalized = search.trim()
  if (normalized.length > 200) throw new Error('Merchant search is too long.')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Merchant search limit is invalid.')
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/transaction-merchants?search=${encodeURIComponent(normalized)}&limit=${limit}`,
    schema: transactionMerchantsResponseSchema,
  })
}

export type ManualTransactionDraft = Readonly<{
  accountId: number
  transactionDate: string
  transactionTypeId: number
  settlementAmount: string
  settlementCurrencyId: number
  existingMerchantId?: number | null
  newMerchantName?: string
  categoryId?: number | null
  description?: string
}>

export type ManualTransactionPayload = Readonly<{
  transactionDate: string
  transactionTypeId: string
  settlementAmount: string
  settlementCurrencyId: string
  transactionMerchantId?: number
  transactionMerchantName?: string
  categoryId?: string
  description?: string
}>

export type FrozenManualTransaction = Readonly<{
  accountId: number
  payload: ManualTransactionPayload
}>

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const unsignedPositiveAmount = z.string().trim().regex(/^(?:\d+\.?\d*|\.\d+)$/).refine((value) => {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0
})

const todayDateOnly = (now: Date): string => {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parsePastOrPresentDate = (value: string, now: Date): string => {
  const parsed = dateOnly.parse(value)
  const instant = new Date(`${parsed}T12:00:00.000Z`)
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== parsed || parsed > todayDateOnly(now)) {
    throw new Error('Transaction date must be a real, nonfuture date.')
  }
  return instant.toISOString()
}

/** Resolves form values into the exact mixed string/number API body and drops all deferred fields. */
export function freezeManualTransaction(draft: ManualTransactionDraft, now = new Date()): FrozenManualTransaction {
  const accountId = positiveId.parse(draft.accountId)
  const transactionTypeId = positiveId.parse(draft.transactionTypeId)
  const settlementCurrencyId = positiveId.parse(draft.settlementCurrencyId)
  const settlementAmount = unsignedPositiveAmount.parse(draft.settlementAmount)
  const existingMerchantId = draft.existingMerchantId == null ? null : positiveId.parse(draft.existingMerchantId)
  const newMerchantName = draft.newMerchantName?.trim() ?? ''
  const merchant = existingMerchantId !== null
    ? { transactionMerchantId: existingMerchantId }
    : newMerchantName.length > 0
      ? { transactionMerchantName: boundedName.parse(newMerchantName) }
      : null
  if (!merchant) throw new Error('Choose an existing merchant or enter a new merchant name.')

  const categoryId = draft.categoryId == null ? null : positiveId.parse(draft.categoryId)
  const description = draft.description?.trim() ?? ''
  if (description.length > 500) throw new Error('Description is too long.')

  return Object.freeze({
    accountId,
    payload: Object.freeze({
      transactionDate: parsePastOrPresentDate(draft.transactionDate, now),
      transactionTypeId: String(transactionTypeId),
      settlementAmount,
      settlementCurrencyId: String(settlementCurrencyId),
      ...merchant,
      ...(categoryId === null ? {} : { categoryId: String(categoryId) }),
      ...(description ? { description } : {}),
    }),
  })
}

export function createManualTransactionEndpoint(accountId: number) {
  positiveId.parse(accountId)
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/${accountId}/transaction`,
    schema: z.undefined(),
  })
}

const OUTGOING_TYPES = new Set(['atm', 'card_payment', 'fee', 'fees', 'loan', 'payment', 'transfer_out'])
export const transactionDirection = (typeName: string): 'debit' | 'credit' => (
  OUTGOING_TYPES.has(typeName.toLocaleLowerCase('en-US')) ? 'debit' : 'credit'
)

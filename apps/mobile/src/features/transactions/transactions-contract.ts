import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

const money = z.number().finite()
const currency = z.object({ code: z.string().regex(/^[A-Z]{3}$/) }).strict()
const positiveId = z.number().int().positive()
const transactionId = z.number().int().safe().refine((value) => value !== 0)

const category = z.object({
  categoryKey: positiveId,
  name: z.string().min(1).max(255),
  icon: z.string().nullable().optional(),
  bgColor: z.string().optional(),
  textColor: z.string().optional(),
  isSystemCategory: z.boolean(),
}).passthrough()

const recurringSeries = z.object({
  recurringSeriesKey: positiveId,
  displayName: z.string().min(1).max(255),
  type: z.enum(['subscription', 'bill']),
  amountType: z.enum(['fixed', 'variable']),
  status: z.enum(['candidate', 'confirmed', 'dismissed', 'ended', 'paused']),
})

const transactionBaseShape = {
  transactionKey: transactionId,
  transactionDate: z.iso.datetime(),
  transactionTypeKey: z.object({ name: z.string().min(1).max(100) }).optional(),
  accountKey: z.object({
    accountKey: positiveId,
    accountName: z.string().max(255).nullish(),
    accountFinancialInstitutionKey: z.object({ logoUrl: z.string().nullable().optional() }).nullable().optional(),
    currencyKey: currency,
  }),
  description: z.string().max(500).nullable().optional(),
  descriptionDirty: z.string().max(1000).nullable().optional(),
  settlementAmount: money.nullish(),
  editedSettlementAmount: money.nullable().optional(),
  settlementCurrencyKey: currency.nullish(),
  appuserSettlementAmount: money.nullish(),
  appuserCurrencyKey: currency.nullish(),
  balance: money.nullish(),
  appuserCurrencyBalance: money.nullish(),
  transactionMerchantKey: z.object({ name: z.string().min(1).max(200) }).nullable().optional(),
  reviewed: z.boolean(),
  hidden: z.boolean().optional(),
  appuserTransactionCategories: z.array(category),
  recurringSeries: recurringSeries.nullable(),
} as const

export const accountTransactionSchema = z.object(transactionBaseShape)
export const aggregateTransactionSchema = z.object({
  ...transactionBaseShape,
  loanRepayment: z.object({
    loanKey: positiveId,
    loanKeys: z.array(positiveId).min(1),
    loanName: z.string().min(1).max(1000),
    principalAmount: money,
    interestAmount: money,
    feeAmount: money,
    spendingAmount: money,
  }).optional(),
})

export const aggregateTransactionsResponseSchema = z.object({
  transactions: z.array(aggregateTransactionSchema),
})
export const accountTransactionsResponseSchema = z.object({
  transactions: z.array(accountTransactionSchema),
})

export type TransactionFilters = Readonly<{
  fromDate?: string
  toDate?: string
  needsReview?: boolean
  includeHidden?: boolean
  limit?: 100 | 500
}>
export type TransactionDto = z.infer<typeof aggregateTransactionSchema>

const encodeFilters = (filters: TransactionFilters): string => {
  const values: string[] = []
  if (filters.fromDate) values.push(`fromDate=${encodeURIComponent(String(Date.parse(filters.fromDate)))}`)
  if (filters.toDate) values.push(`toDate=${encodeURIComponent(String(Date.parse(filters.toDate)))}`)
  if (filters.needsReview) values.push('unreviewedOnly=true')
  if (filters.includeHidden) values.push('includeHidden=true')
  if (filters.limit) values.push(`limit=${filters.limit}`)
  return values.length ? `?${values.join('&')}` : ''
}

export function createAggregateTransactionsEndpoint(filters: TransactionFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/transaction${encodeFilters(filters)}`,
    schema: aggregateTransactionsResponseSchema,
  })
}

export function createAccountTransactionsEndpoint(accountId: number, filters: TransactionFilters) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('A positive safe account id is required.')
  const query = encodeFilters(filters)
  const joiner = query ? '&' : '?'
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/${accountId}/transaction${query}${joiner}accountId=${accountId}`,
    schema: accountTransactionsResponseSchema,
  })
}

export const updateTransactionsEndpoint = writeEndpoint({
  method: 'PATCH',
  path: '/v1/account/transaction',
  schema: z.unknown(),
})

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/

/** Resolves a pair of plain YYYY-MM-DD strings into an inclusive fromDate/toDate ISO range
 * (matching web's DatePickerRange semantics, where the "to" day is fully included), mirroring
 * the existing plain-text date-entry convention used elsewhere in mobile (no date-picker
 * dependency exists in this codebase). */
export function parseTransactionDateRange(fromDate: string, toDate: string): Readonly<{ fromDate: string; toDate: string }> {
  if (!dateOnlyPattern.test(fromDate) || !dateOnlyPattern.test(toDate)) {
    throw new Error('Enter both dates as YYYY-MM-DD.')
  }
  const from = new Date(`${fromDate}T00:00:00.000Z`)
  const to = new Date(`${toDate}T23:59:59.999Z`)
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== fromDate) throw new Error('The start date is not a real calendar date.')
  if (Number.isNaN(to.getTime()) || to.toISOString().slice(0, 10) !== toDate) throw new Error('The end date is not a real calendar date.')
  if (from.getTime() > to.getTime()) throw new Error('The start date must not be after the end date.')
  return Object.freeze({ fromDate: from.toISOString(), toDate: to.toISOString() })
}

// Kept as an alias for the focused, single-row review call site.
export const markTransactionsReviewedEndpoint = updateTransactionsEndpoint

export type EditTransactionAmountDraft = Readonly<{ transactionId: number; updatedAmount: string; description?: string }>
export type FrozenEditTransactionAmount = Readonly<{
  transactionId: number
  payload: Readonly<{ updatedAmount: string; description?: string }>
}>

const signedNumericString = z.string().trim().regex(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/)
const editableDescription = z.string().trim().max(500)

/** Resolves an edit-amount draft into the exact API body. The server, not this client, enforces
 * the magnitude-can-only-shrink-toward-zero rule, since it depends on the transaction's original
 * signed amount, which this draft does not carry. `description` is only included in the payload
 * when the caller supplied one, so amount-only callers keep sending the original minimal body. */
export function freezeEditTransactionAmount(draft: EditTransactionAmountDraft): FrozenEditTransactionAmount {
  const transactionId = positiveId.parse(draft.transactionId)
  const updatedAmount = signedNumericString.parse(draft.updatedAmount.trim())
  if (!Number.isFinite(Number(updatedAmount))) throw new Error('Amount must be a real number.')
  const description = draft.description === undefined ? undefined : editableDescription.parse(draft.description)
  return Object.freeze({
    transactionId,
    payload: Object.freeze(description === undefined ? { updatedAmount } : { updatedAmount, description }),
  })
}

export function createEditTransactionAmountEndpoint(transactionId: number) {
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/account/transaction/${positiveId.parse(transactionId)}`,
    schema: z.unknown(),
  })
}

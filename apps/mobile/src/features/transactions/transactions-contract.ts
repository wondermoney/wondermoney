import { z } from 'zod'

import { tagSchema } from '@/features/tags/tags-contract'
import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'
import { deviceTimeZone } from '@/lib/dates/transaction-date'

const money = z.number().finite()
const currency = z.object({ code: z.string().regex(/^[A-Z]{3}$/) })
const positiveId = z.number().int().positive()
const transactionId = z.number().int().safe().refine((value) => value !== 0)

const category = z.object({
  categoryKey: positiveId,
  name: z.string().min(1).max(255),
  icon: z.string().nullable().optional(),
  bgColor: z.string().optional(),
  textColor: z.string().optional(),
  isSystemCategory: z.boolean(),
  countsAsSpending: z.boolean().optional(),
}).passthrough()

export const TRANSFER_DESTINATION_TYPES = ['account', 'portfolio', 'goal'] as const
export type TransferDestinationType = (typeof TRANSFER_DESTINATION_TYPES)[number]

/** Where an outgoing transfer went: another household account, a portfolio or a goal. */
const transferDestination = z.object({
  type: z.enum(TRANSFER_DESTINATION_TYPES),
  key: positiveId,
  name: z.string().max(1000).nullish(),
})

const recurringSeries = z.object({
  recurringSeriesKey: positiveId,
  displayName: z.string().min(1).max(255),
  // Values this build doesn't know read as 'unknown', so one new recurring type or status can't
  // fail the whole transaction list.
  type: tolerantEnum(['subscription', 'bill'], 'unknown'),
  amountType: tolerantEnum(['fixed', 'variable'], 'unknown'),
  status: tolerantEnum(['candidate', 'confirmed', 'dismissed', 'ended', 'paused'], 'unknown'),
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
  // Optional: a server from before tags omits the field, and the row reads as untagged.
  tags: z.array(tagSchema).optional(),
  recurringSeries: recurringSeries.nullable(),
  // Optional: a server from before transfer destinations omits it. A destination of a type this
  // build does not know reads as none rather than failing the list.
  transferDestination: transferDestination.nullable().optional().catch(null),
} as const

const accountTransactionSchema = z.object(transactionBaseShape)
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

/**
 * Paging facts the list endpoints return beside the rows. `total` counts every
 * matching row (synthetic opening-balance rows included, like the page itself),
 * so "Showing 101 of 342" compares like with like; it is `null` on later pages.
 * Both are optional so an older server that omits them still parses.
 */
const pageFacts = {
  total: z.number().int().nonnegative().nullable().optional(),
  hasMore: z.boolean().optional(),
}
export const aggregateTransactionsResponseSchema = z.object({
  transactions: z.array(aggregateTransactionSchema),
  ...pageFacts,
})
export const accountTransactionsResponseSchema = z.object({
  transactions: z.array(accountTransactionSchema),
  ...pageFacts,
})

export type TransactionFilters = Readonly<{
  fromDate?: string
  toDate?: string
  needsReview?: boolean
  includeHidden?: boolean
  /** Tag keys; the server returns rows carrying any of them. */
  tagIds?: readonly number[]
  limit?: 100 | 500
}>
export type TransactionDto = z.infer<typeof aggregateTransactionSchema>

/**
 * The query for `filters`. A date range goes with the device's time zone (`timeZone`), so the API
 * counts a bank booking (a date with no time) on the calendar day the range was picked in.
 */
const encodeFilters = (filters: TransactionFilters, timeZone: string | undefined): string => {
  const values: string[] = []
  if (filters.fromDate) values.push(`fromDate=${encodeURIComponent(String(Date.parse(filters.fromDate)))}`)
  if (filters.toDate) values.push(`toDate=${encodeURIComponent(String(Date.parse(filters.toDate)))}`)
  if ((filters.fromDate || filters.toDate) && timeZone) values.push(`timezone=${encodeURIComponent(timeZone)}`)
  if (filters.needsReview) values.push('unreviewedOnly=true')
  if (filters.includeHidden) values.push('includeHidden=true')
  if (filters.tagIds && filters.tagIds.length > 0) values.push(`tagKeys=${encodeURIComponent(filters.tagIds.join(','))}`)
  if (filters.limit) values.push(`limit=${filters.limit}`)
  return values.length ? `?${values.join('&')}` : ''
}

export function createAggregateTransactionsEndpoint(filters: TransactionFilters, timeZone: string | undefined = deviceTimeZone()) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/transaction${encodeFilters(filters, timeZone)}`,
    schema: aggregateTransactionsResponseSchema,
  })
}

export function createAccountTransactionsEndpoint(accountId: number, filters: TransactionFilters, timeZone: string | undefined = deviceTimeZone()) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('A positive safe account id is required.')
  const query = encodeFilters(filters, timeZone)
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

export const TRANSFER_TYPES = ['TRANSFER_OUT', 'TRANSFER_IN'] as const
export type TransactionTypeChoice = 'TRANSFER_OUT' | 'TRANSFER_IN' | 'PAYMENT' | 'DEPOSIT'

export const isTransferType = (type: string | null | undefined): boolean => type === 'TRANSFER_OUT' || type === 'TRANSFER_IN'

/**
 * A change to how a transaction is typed: marked as a transfer between the household's own money
 * (left out of spending and income), or back to an ordinary payment or deposit. The type follows
 * the amount's sign; the destination only applies to money going out.
 */
export type TransferEditDraft = Readonly<{
  transactionId: number
  /** The row's amount sign: money out or money in. */
  direction: 'debit' | 'credit'
  transfer: boolean
  /** Outgoing transfers only. Undefined leaves it as it is; null clears it. */
  destination?: Readonly<{ type: TransferDestinationType; key: number }> | null
}>
export type FrozenTransferEdit = Readonly<{
  transactionId: number
  payload: Readonly<{ transactionType: TransactionTypeChoice; transferDestination?: Readonly<{ type: TransferDestinationType; key: number }> | null }>
}>

export function freezeTransferEdit(draft: TransferEditDraft): FrozenTransferEdit {
  const transactionId = positiveId.parse(draft.transactionId)
  const outgoing = draft.direction === 'debit'
  const transactionType: TransactionTypeChoice = draft.transfer
    ? (outgoing ? 'TRANSFER_OUT' : 'TRANSFER_IN')
    : (outgoing ? 'PAYMENT' : 'DEPOSIT')
  if (draft.destination != null && !(draft.transfer && outgoing)) throw new Error('Only money going out as a transfer has a destination.')
  const destination = draft.destination == null
    ? draft.destination
    : Object.freeze({ type: z.enum(TRANSFER_DESTINATION_TYPES).parse(draft.destination.type), key: positiveId.parse(draft.destination.key) })
  return Object.freeze({
    transactionId,
    payload: Object.freeze(destination === undefined || !draft.transfer || !outgoing ? { transactionType } : { transactionType, transferDestination: destination }),
  })
}

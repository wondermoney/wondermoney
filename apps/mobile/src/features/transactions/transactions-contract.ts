import { z } from 'zod'

import { tagSchema } from '@/features/tags/tags-contract'
import { fxRateDateSchema, fxStatusSchema } from '@/lib/api/fx-status'
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

/**
 * One line of a split transaction, as the list and the split endpoints return it. A split shares
 * one transaction's amount over several categories; the lines always add up to that amount, each
 * with its sign. A row that is not split has no lines.
 */
const transactionSplitLine = z.object({
  transactionSplitKey: positiveId,
  /** In the transaction's settlement (account) currency, signed. */
  amount: money,
  /** The line's share in the owner's currency; null when the transaction has no converted amount. */
  appuserAmount: money.nullable().optional(),
  /** Null for an uncategorized line. */
  category: category.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  position: z.number().int().nonnegative(),
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
  // How `appuserSettlementAmount` was converted; optional, an older API doesn't send them.
  fxStatus: fxStatusSchema,
  fxRateDate: fxRateDateSchema,
  transactionMerchantKey: z.object({ name: z.string().min(1).max(200) }).nullable().optional(),
  reviewed: z.boolean(),
  hidden: z.boolean().optional(),
  // The bank sent the row, so it can be hidden but not deleted. Optional: an older API omits it.
  bankSynced: z.boolean().optional(),
  appuserTransactionCategories: z.array(category),
  // Optional: a server from before tags omits the field, and the row reads as untagged.
  tags: z.array(tagSchema).optional(),
  // Optional: a server from before splits omits the field, and the row reads as unsplit.
  splits: z.array(transactionSplitLine).optional(),
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

/**
 * The home's review status: how many transactions await review and what their
 * absolute amounts add up to in the reader's base currency. `count` is the
 * list's `total` for `unreviewedOnly=true`; the API computes both from one query.
 */
export const transactionReviewSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  totalAbs: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
})
export type TransactionReviewSummaryDto = z.infer<typeof transactionReviewSummarySchema>

export type TransactionFilters = Readonly<{
  fromDate?: string
  toDate?: string
  needsReview?: boolean
  includeHidden?: boolean
  /** Tag keys; the server returns rows carrying any of them. */
  tagIds?: readonly number[]
  /** Category keys; the server returns rows assigned to any of them. */
  categoryIds?: readonly number[]
  /** Money in or money out only. */
  direction?: 'in' | 'out'
  /** Leave out transfers between the household's own accounts. */
  excludeTransfers?: boolean
  /** Leave out rows wholly in categories that are not spending. */
  excludeNonSpending?: boolean
  /** The statuses that count; omitted leaves the API's default. */
  statuses?: readonly ('BOOKED' | 'PENDING')[]
  limit?: 100 | 500
}>
export type TransactionDto = z.infer<typeof aggregateTransactionSchema>

/**
 * The query for `filters`. A date range goes with the device's time zone (`timeZone`), so the API
 * counts a bank booking (a date with no time) on the calendar day the range was picked in.
 */
/**
 * The list's server filters as the API names them, without paging: the query of the list, and the
 * `filter` a bulk change or delete takes for "every matching row". Unset filters are left out
 * (the API refuses a key it does not know, so nothing extra is sent).
 */
export const transactionFilterParams = (filters: TransactionFilters, timeZone: string | undefined = deviceTimeZone()): Record<string, string> => {
  const values: Record<string, string> = {}
  if (filters.fromDate) values.fromDate = String(Date.parse(filters.fromDate))
  if (filters.toDate) values.toDate = String(Date.parse(filters.toDate))
  if ((filters.fromDate || filters.toDate) && timeZone) values.timezone = timeZone
  if (filters.needsReview) values.unreviewedOnly = 'true'
  if (filters.includeHidden) values.includeHidden = 'true'
  if (filters.tagIds && filters.tagIds.length > 0) values.tagKeys = filters.tagIds.join(',')
  if (filters.categoryIds && filters.categoryIds.length > 0) values.categoryKeys = filters.categoryIds.join(',')
  if (filters.direction) values.direction = filters.direction
  if (filters.excludeTransfers) values.excludeTransfers = 'true'
  if (filters.excludeNonSpending) values.excludeNonSpending = 'true'
  if (filters.statuses && filters.statuses.length > 0) values.statuses = filters.statuses.join(',')
  return values
}

const encodeFilters = (filters: TransactionFilters, timeZone: string | undefined): string => {
  const values = Object.entries(transactionFilterParams(filters, timeZone)).map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
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

export const transactionReviewSummaryEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account/transaction/review-summary',
  schema: transactionReviewSummarySchema,
})

export const updateTransactionsEndpoint = writeEndpoint({
  method: 'PATCH',
  path: '/v1/account/transaction',
  schema: z.unknown(),
})

/** The API's cap on one bulk change or delete, by ids or by filter. */
export const BULK_TRANSACTION_LIMIT = 5000

/**
 * What a bulk delete did. Rows the bank sent are never deleted (the next sync would send them
 * again); they come back as skipped, with their ids, so the app can offer to hide them.
 */
export const deleteTransactionsResponseSchema = z.object({
  deletedTransactionIds: z.array(positiveId),
  skipped: z.array(z.object({ reason: z.string(), transactionIds: z.array(positiveId) })),
})
export type DeleteTransactionsResult = z.infer<typeof deleteTransactionsResponseSchema>

export const deleteTransactionsEndpoint = writeEndpoint({
  method: 'DELETE',
  path: '/v1/account/transaction',
  schema: deleteTransactionsResponseSchema,
})

/** One row: 204, or 409 for a row the bank sent. */
export function createDeleteTransactionEndpoint(transactionId: number) {
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) throw new Error('A positive safe transaction id is required.')
  return writeEndpoint({ method: 'DELETE', path: `/v1/account/transaction/${transactionId}`, schema: z.undefined(), successStatuses: [204] })
}

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

/** One line of a split transaction, as the list and the split endpoints return it. */
export type TransactionSplitLineDto = z.infer<typeof transactionSplitLine>

/** One line of a `PUT .../splits` request. */
export type TransactionSplitLineRequest = Readonly<{
  /** Null for an uncategorized line. */
  categoryId: number | null
  /** A dot decimal in the settlement currency, with the transaction's sign ("-12.5"). */
  amount: string
  notes: string | null
}>

export type SetTransactionSplitsDraft = Readonly<{
  transactionId: number
  lines: readonly TransactionSplitLineRequest[]
}>
export type FrozenSetTransactionSplits = Readonly<{
  transactionId: number
  payload: readonly TransactionSplitLineRequest[]
}>

/** The API stores line amounts with four decimals and takes at most this many lines. */
const SPLIT_LINE_AMOUNT = /^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/
export const MAX_SPLIT_LINES = 50

const splitLineRequest = z.object({
  categoryId: positiveId.nullable(),
  amount: z.string().trim().regex(SPLIT_LINE_AMOUNT),
  notes: z.string().trim().max(500).nullable(),
}).strict()

/**
 * Resolves the editor's lines into the exact `PUT .../splits` body. The API checks the rules that
 * need the transaction (at least two lines, the signs, the sum); this only guarantees the shape.
 */
export function freezeSetTransactionSplits(draft: SetTransactionSplitsDraft): FrozenSetTransactionSplits {
  const transactionId = positiveId.parse(draft.transactionId)
  if (draft.lines.length < 2) throw new Error('A split needs at least two lines.')
  if (draft.lines.length > MAX_SPLIT_LINES) throw new Error(`A split takes at most ${MAX_SPLIT_LINES} lines.`)
  const lines = draft.lines.map((line) => {
    const parsed = splitLineRequest.parse({
      categoryId: line.categoryId,
      amount: line.amount,
      notes: line.notes === null ? null : line.notes.trim() === '' ? null : line.notes,
    })
    return Object.freeze({
      categoryId: parsed.categoryId,
      amount: parsed.amount,
      notes: parsed.notes,
    })
  })
  return Object.freeze({ transactionId, payload: Object.freeze(lines) })
}

/** `PUT /v1/account/transaction/:id/splits`: replace every line of the transaction's split. */
export function createSetTransactionSplitsEndpoint(transactionId: number) {
  return writeEndpoint({
    method: 'PUT',
    path: `/v1/account/transaction/${positiveId.parse(transactionId)}/splits`,
    schema: z.object({
      transaction: z.object({
        transactionKey: z.number().int(),
        splits: z.array(transactionSplitLine),
      }).passthrough(),
    }),
  })
}

/** `DELETE /v1/account/transaction/:id/splits`: remove the split, keeping the largest line's category. */
export function createRemoveTransactionSplitsEndpoint(transactionId: number) {
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/account/transaction/${positiveId.parse(transactionId)}/splits`,
    schema: z.object({
      transaction: z.object({
        transactionKey: z.number().int(),
        splits: z.array(transactionSplitLine),
      }).passthrough(),
    }),
  })
}

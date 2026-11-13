import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Reimbursement links (issue #41): a refund (money in) linked to the expense (money out) it pays
 * back, with an amount. The linked amount comes off the expense's category spending and off
 * income; balances do not change. A link is many-to-many, and the links on either side never add
 * up to more than that side's amount. In this version both sides share one settlement currency.
 */

const money = z.number().finite()
const positiveId = z.number().int().positive()
const currencyCode = z.string().regex(/^[A-Z]{3}$/)

/** The other side of a link, as much of it as a link or a suggestion carries. */
export const linkedTransactionSchema = z.object({
  transactionKey: positiveId,
  accountKey: positiveId.nullable(),
  accountName: z.string().max(255).nullable(),
  description: z.string().max(1000).nullable(),
  merchantName: z.string().max(255).nullable(),
  transactionDate: z.string().nullable(),
  /** Signed and effective (a person's edit wins), in `currencyCode`. */
  settlementAmount: money.nullable(),
  currencyCode: currencyCode.nullable(),
})
export type LinkedTransactionDto = z.infer<typeof linkedTransactionSchema>

export const reimbursementLinkSchema = z.object({
  transactionReimbursementKey: positiveId,
  /** Positive, in `currencyCode`. */
  amount: money.positive(),
  currencyCode,
  createdAt: z.string(),
  expense: linkedTransactionSchema,
  reimbursement: linkedTransactionSchema,
})
export type ReimbursementLinkDto = z.infer<typeof reimbursementLinkSchema>

/** `GET /v1/account/transaction/:id/reimbursements`: the transaction's links, in either role. */
export const transactionReimbursementsSchema = z.object({
  /** By the amount's sign: money out is an expense, money in a reimbursement. */
  role: tolerantEnum(['expense', 'reimbursement'], null).nullable(),
  currencyCode: currencyCode.nullable(),
  linkedAmount: money.nonnegative(),
  remainingAmount: money.nonnegative(),
  links: z.array(reimbursementLinkSchema),
})
export type TransactionReimbursementsDto = z.infer<typeof transactionReimbursementsSchema>

export const reimbursementSuggestionSchema = linkedTransactionSchema.extend({
  remainingAmount: money.nonnegative(),
  /** Why it was suggested. A reason this build does not know reads as 'other'. */
  reason: tolerantEnum(['merchant', 'amount', 'search'], 'other'),
})
export type ReimbursementSuggestionDto = z.infer<typeof reimbursementSuggestionSchema>

export const reimbursementSuggestionsSchema = z.object({
  suggestions: z.array(reimbursementSuggestionSchema),
})

const pathId = (transactionId: number) => positiveId.parse(transactionId)

export function createTransactionReimbursementsEndpoint(transactionId: number) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/transaction/${pathId(transactionId)}/reimbursements`,
    schema: transactionReimbursementsSchema,
  })
}

export const SUGGESTION_SEARCH_MAX = 200
export const DEFAULT_SUGGESTION_LIMIT = 10

/**
 * Candidates for the other side. Without `search` the API picks by merchant or amount over 60
 * days; with it, by text over any date. Direction, currency and remaining capacity always apply.
 */
export function createReimbursementSuggestionsEndpoint(
  transactionId: number,
  options: Readonly<{ search?: string; limit?: number }> = {},
) {
  const params: string[] = []
  const search = options.search?.trim().slice(0, SUGGESTION_SEARCH_MAX)
  if (search) params.push(`search=${encodeURIComponent(search)}`)
  const limit = options.limit ?? DEFAULT_SUGGESTION_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('The suggestion limit is 1 to 50.')
  params.push(`limit=${limit}`)
  return readEndpoint({
    method: 'GET',
    path: `/v1/account/transaction/${pathId(transactionId)}/reimbursements/suggestions?${params.join('&')}`,
    schema: reimbursementSuggestionsSchema,
  })
}

export type LinkReimbursementDraft = Readonly<{
  /** The reimbursement: money in. */
  transactionId: number
  expenseTransactionId: number
  /** A dot decimal, positive, at most four decimals, in the expense's currency. */
  amount: string
}>
export type FrozenLinkReimbursement = Readonly<{
  transactionId: number
  payload: Readonly<{ expenseTransactionId: number; amount: number }>
}>

const LINK_AMOUNT = /^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/

/** Resolves a link draft into the exact `POST .../reimbursements` body. */
export function freezeLinkReimbursement(draft: LinkReimbursementDraft): FrozenLinkReimbursement {
  const transactionId = positiveId.parse(draft.transactionId)
  const expenseTransactionId = positiveId.parse(draft.expenseTransactionId)
  if (transactionId === expenseTransactionId) throw new Error('A transaction cannot reimburse itself.')
  const text = draft.amount.trim()
  if (!LINK_AMOUNT.test(text)) throw new Error('The amount must be a positive decimal with at most 4 decimals.')
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('The amount must be more than zero.')
  return Object.freeze({ transactionId, payload: Object.freeze({ expenseTransactionId, amount }) })
}

/** `POST /v1/account/transaction/:id/reimbursements`; `:id` is the reimbursement (money in). */
export function createLinkReimbursementEndpoint(transactionId: number) {
  return writeEndpoint({
    method: 'POST',
    path: `/v1/account/transaction/${pathId(transactionId)}/reimbursements`,
    schema: z.object({ link: reimbursementLinkSchema }),
  })
}

/** `DELETE /v1/account/transaction/:id/reimbursements/:linkId`; `:id` may be either side. */
export function createUnlinkReimbursementEndpoint(transactionId: number, transactionReimbursementKey: number) {
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/account/transaction/${pathId(transactionId)}/reimbursements/${positiveId.parse(transactionReimbursementKey)}`,
    schema: z.object({ transactionReimbursementKey: positiveId }),
  })
}

/** The API's reasons for refusing a link (`ERROR_CODE` in the API). */
export const REIMBURSEMENT_ERROR_CODES = [
  'not_found',
  'reimbursement_currency_mismatch',
  'reimbursement_amount_exceeded',
  'reimbursement_visibility_mismatch',
  'reimbursement_invalid',
  'reimbursement_link_exists',
] as const
export type ReimbursementErrorCode = (typeof REIMBURSEMENT_ERROR_CODES)[number]

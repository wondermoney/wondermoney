import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Expense groups (issue #98): people who share costs, what each owes, and how they settle up.
 * Mirrors `apps/api/src/routes/v1/expense-group.ts` and the DTOs in its service.
 *
 * A group's members are people of the household (`appuserKey` set) or people with no account,
 * known by name. A cost is shared by splitting one household transaction by person; the group
 * records who paid, always someone of the household. Balances are per currency and never
 * converted: positive means the group owes that person, negative that they owe the group.
 */

const money = z.number().finite()
const positiveId = z.number().int().positive()
const currencyCode = z.string().regex(/^[A-Z]{3}$/)
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const expenseGroupMemberSchema = z.object({
  expenseGroupMemberKey: positiveId,
  name: z.string().max(255),
  email: z.string().max(254).nullable(),
  /** The household member this person is; null for someone outside the household. */
  appuserKey: positiveId.nullable(),
  /** Whether their shares count in the household's totals. */
  isHouseholdMember: z.boolean(),
  /** Whether this person is the one reading. */
  isYou: z.boolean(),
  position: z.number().int(),
})
export type ExpenseGroupMemberDto = z.infer<typeof expenseGroupMemberSchema>

const currencyAmount = z.object({ amount: money, currencyCode })

export const expenseGroupSchema = z.object({
  expenseGroupKey: positiveId,
  name: z.string().max(255),
  /** The default currency for settlements. */
  currencyCode,
  archived: z.boolean(),
  createdAt: z.string(),
  members: z.array(expenseGroupMemberSchema),
  /** The reader's balance per currency (positive: they are owed); empty when they are not in it. */
  yourBalances: z.array(currencyAmount),
})
export type ExpenseGroupDto = z.infer<typeof expenseGroupSchema>

/** The household transaction behind a shared expense or a settlement. */
export const groupTransactionSchema = z.object({
  transactionKey: positiveId,
  description: z.string().max(1000).nullable(),
  merchantName: z.string().max(255).nullable(),
  transactionDate: z.string().nullable(),
  /** Signed (money out is negative), the person's edit when there is one, in `currencyCode`. */
  settlementAmount: money.nullable(),
  currencyCode: currencyCode.nullable(),
  accountKey: positiveId.nullable(),
  accountName: z.string().max(255).nullable(),
})
export type GroupTransactionDto = z.infer<typeof groupTransactionSchema>

export const SPLIT_METHODS = ['equal', 'amounts', 'percentages'] as const
export type SplitMethod = (typeof SPLIT_METHODS)[number]

export const groupExpenseSchema = z.object({
  expenseGroupExpenseKey: positiveId,
  expenseGroupKey: positiveId,
  categoryKey: positiveId.nullable(),
  currencyCode: currencyCode.nullable(),
  paidByMemberKey: positiveId,
  // A method this build does not know reads as 'unknown' and is edited as amounts.
  splitMethod: tolerantEnum(SPLIT_METHODS, 'unknown'),
  /** Signed like the transaction; they add up to its amount. */
  shares: z.array(z.object({ expenseGroupMemberKey: positiveId, amount: money })),
  transaction: groupTransactionSchema,
})
export type GroupExpenseDto = z.infer<typeof groupExpenseSchema>

export const groupSettlementSchema = z.object({
  expenseGroupSettlementKey: positiveId,
  expenseGroupKey: positiveId,
  fromMemberKey: positiveId,
  toMemberKey: positiveId,
  /** Positive, in `currencyCode`. */
  amount: money.positive(),
  currencyCode,
  settledOn: isoDay,
  notes: z.string().max(500).nullable(),
  /** Whether a transaction is linked, whether or not the reader may see it. */
  isLinked: z.boolean(),
  /** The linked transaction, when the reader may see it. */
  transaction: groupTransactionSchema.nullable(),
  createdAt: z.string(),
})
export type GroupSettlementDto = z.infer<typeof groupSettlementSchema>

export const memberBalanceSchema = z.object({
  memberKey: positiveId,
  paid: money,
  share: money,
  settlementsPaid: money,
  settlementsReceived: money,
  /** Positive: the group owes them; negative: they owe the group. */
  balance: money,
})
export type MemberBalanceDto = z.infer<typeof memberBalanceSchema>

export const suggestedPaymentSchema = z.object({ fromMemberKey: positiveId, toMemberKey: positiveId, amount: money.positive() })
export type SuggestedPaymentDto = z.infer<typeof suggestedPaymentSchema>

export const groupBalancesSchema = z.object({
  expenseGroupKey: positiveId,
  currencies: z.array(z.object({
    currencyCode,
    members: z.array(memberBalanceSchema),
    /** Payments that would clear every balance in this currency. */
    payments: z.array(suggestedPaymentSchema),
  })),
})
export type GroupBalancesDto = z.infer<typeof groupBalancesSchema>
export type CurrencyBalancesDto = GroupBalancesDto['currencies'][number]

export const settlementSuggestionSchema = groupTransactionSchema.extend({
  /** What is left to link on it, positive. */
  remainingAmount: money.nonnegative(),
})
export type SettlementSuggestionDto = z.infer<typeof settlementSuggestionSchema>

const pathId = (value: number) => positiveId.parse(value)
const base = (groupId: number) => `/v1/expense-groups/${pathId(groupId)}`

export const expenseGroupsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/expense-groups',
  schema: z.object({ groups: z.array(expenseGroupSchema) }),
})

export const createExpenseGroupEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/expense-groups',
  schema: z.object({ group: expenseGroupSchema }),
})

export function createExpenseGroupDetailEndpoint(groupId: number) {
  return readEndpoint({ method: 'GET', path: base(groupId), schema: z.object({ group: expenseGroupSchema }) })
}

export function createUpdateExpenseGroupEndpoint(groupId: number) {
  return writeEndpoint({ method: 'PATCH', path: base(groupId), schema: z.object({ group: expenseGroupSchema }) })
}

export function createDeleteExpenseGroupEndpoint(groupId: number) {
  return writeEndpoint({ method: 'DELETE', path: base(groupId), schema: z.object({ expenseGroupKey: positiveId }) })
}

export function createGroupBalancesEndpoint(groupId: number) {
  return readEndpoint({ method: 'GET', path: `${base(groupId)}/balances`, schema: groupBalancesSchema })
}

export function createAddGroupMemberEndpoint(groupId: number) {
  return writeEndpoint({ method: 'POST', path: `${base(groupId)}/members`, schema: z.object({ member: expenseGroupMemberSchema }) })
}

export function createRemoveGroupMemberEndpoint(groupId: number, memberId: number) {
  return writeEndpoint({ method: 'DELETE', path: `${base(groupId)}/members/${pathId(memberId)}`, schema: z.object({ expenseGroupMemberKey: positiveId }) })
}

export function createGroupExpensesEndpoint(groupId: number) {
  return readEndpoint({ method: 'GET', path: `${base(groupId)}/shares`, schema: z.object({ expenses: z.array(groupExpenseSchema) }) })
}

export function createGroupExpenseEndpoint(groupId: number, transactionId: number) {
  return readEndpoint({ method: 'GET', path: `${base(groupId)}/shares/${pathId(transactionId)}`, schema: z.object({ expense: groupExpenseSchema }) })
}

export function createShareExpenseEndpoint(groupId: number) {
  return writeEndpoint({ method: 'POST', path: `${base(groupId)}/shares`, schema: z.object({ expense: groupExpenseSchema }) })
}

export function createUnshareExpenseEndpoint(groupId: number, transactionId: number) {
  return writeEndpoint({ method: 'DELETE', path: `${base(groupId)}/shares/${pathId(transactionId)}`, schema: z.object({ transactionKey: positiveId }) })
}

export function createGroupSettlementsEndpoint(groupId: number) {
  return readEndpoint({ method: 'GET', path: `${base(groupId)}/settlements`, schema: z.object({ settlements: z.array(groupSettlementSchema) }) })
}

export const SETTLEMENT_SEARCH_MAX = 200
export const DEFAULT_SETTLEMENT_SUGGESTION_LIMIT = 10

export type SettlementSuggestionQuery = Readonly<{
  fromMemberId: number
  toMemberId: number
  currencyCode?: string
  search?: string
  limit?: number
}>

/**
 * Transactions that could be the money behind a settlement: money in when someone outside the
 * household pays it back, money out when the household pays someone. The API answers an empty
 * list when both people are of the household, or both are not.
 */
export function createSettlementSuggestionsEndpoint(groupId: number, query: SettlementSuggestionQuery) {
  const params = [`fromMemberId=${pathId(query.fromMemberId)}`, `toMemberId=${pathId(query.toMemberId)}`]
  if (query.currencyCode) params.push(`currencyCode=${currencyCode.parse(query.currencyCode)}`)
  const search = query.search?.trim().slice(0, SETTLEMENT_SEARCH_MAX)
  if (search) params.push(`search=${encodeURIComponent(search)}`)
  const limit = query.limit ?? DEFAULT_SETTLEMENT_SUGGESTION_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('The suggestion limit is 1 to 50.')
  params.push(`limit=${limit}`)
  return readEndpoint({
    method: 'GET',
    path: `${base(groupId)}/settlements/suggestions?${params.join('&')}`,
    schema: z.object({ suggestions: z.array(settlementSuggestionSchema) }),
  })
}

export function createRecordSettlementEndpoint(groupId: number) {
  return writeEndpoint({ method: 'POST', path: `${base(groupId)}/settlements`, schema: z.object({ settlement: groupSettlementSchema }) })
}

export function createDeleteSettlementEndpoint(groupId: number, settlementId: number) {
  return writeEndpoint({ method: 'DELETE', path: `${base(groupId)}/settlements/${pathId(settlementId)}`, schema: z.object({ expenseGroupSettlementKey: positiveId }) })
}

// ---------------------------------------------------------------------------------------------
// Request bodies: each draft is resolved into the exact body the API validates, or throws.
// ---------------------------------------------------------------------------------------------

/** The API's caps (`validators/expense-group.ts`). */
export const GROUP_NAME_MAX = 100
export const MEMBER_NAME_MAX = 100
export const MAX_GROUP_PEOPLE = 50
export const SETTLEMENT_NOTES_MAX = 500

const nameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX)
const emailSchema = z.email().max(254)

export type PersonDraft = Readonly<{ name: string; email?: string }>
export type MemberPayload = Readonly<{ name: string; email?: string; householdMemberId?: number }>

/** Someone outside the household: a name, and an email only when one was typed. */
export function freezePerson(person: PersonDraft): MemberPayload {
  const name = z.string().trim().min(1).max(MEMBER_NAME_MAX).parse(person.name)
  const email = person.email?.trim() ?? ''
  return Object.freeze(email ? { name, email: emailSchema.parse(email) } : { name })
}

/** Someone of the household, by their user key; the API uses their own name. */
export function freezeHouseholdPerson(appuserKey: number): MemberPayload {
  return Object.freeze({ name: '', householdMemberId: positiveId.parse(appuserKey) })
}

export type CreateGroupDraft = Readonly<{
  name: string
  currencyCode: string
  people: readonly PersonDraft[]
  /** Other household members to add; the creator joins on their own. */
  householdMemberIds: readonly number[]
}>
export type CreateGroupPayload = Readonly<{ name: string; currencyCode: string; members: readonly MemberPayload[] }>

export function freezeCreateGroup(draft: CreateGroupDraft): CreateGroupPayload {
  const members = [
    ...new Set(draft.householdMemberIds),
  ].map(freezeHouseholdPerson).concat(draft.people.map(freezePerson))
  if (members.length > MAX_GROUP_PEOPLE) throw new Error(`A group takes at most ${MAX_GROUP_PEOPLE} people.`)
  return Object.freeze({
    name: nameSchema.parse(draft.name),
    currencyCode: currencyCode.parse(draft.currencyCode.trim().toUpperCase()),
    members: Object.freeze(members),
  })
}

export type UpdateGroupDraft = Readonly<{ name: string; currencyCode: string }>
export type UpdateGroupPayload = Readonly<{ name?: string; currencyCode?: string }>

/**
 * An "Edit group" draft as the `PATCH /v1/expense-groups/:id` body: only what differs from the
 * group, the name trimmed and the currency upper-cased as the API stores them; null when nothing
 * changes. The API takes any known currency at any time: it only sets what new settlements
 * default to, and recorded expenses and settlements keep their own.
 */
export function freezeUpdateGroup(group: Readonly<{ name: string; currencyCode: string }>, draft: UpdateGroupDraft): UpdateGroupPayload | null {
  const name = nameSchema.parse(draft.name)
  const code = currencyCode.parse(draft.currencyCode.trim().toUpperCase())
  const payload = {
    ...(name !== group.name ? { name } : {}),
    ...(code !== group.currencyCode ? { currencyCode: code } : {}),
  }
  return Object.keys(payload).length > 0 ? Object.freeze(payload) : null
}

export type ShareLinePayload = Readonly<{ memberId: number; amount?: number; percentage?: number }>
export type ShareExpensePayload = Readonly<{
  transactionId: number
  paidByMemberId: number
  method: SplitMethod
  shares: readonly ShareLinePayload[]
}>

/** `POST .../shares`: the payer and each person's line, by method (amounts positive, as decimals). */
export function freezeShareExpense(draft: ShareExpensePayload): ShareExpensePayload {
  if (!SPLIT_METHODS.includes(draft.method)) throw new Error('Unknown split method.')
  if (draft.shares.length < 1 || draft.shares.length > MAX_GROUP_PEOPLE) throw new Error('A share needs one to fifty people.')
  const memberIds = draft.shares.map((share) => pathId(share.memberId))
  if (new Set(memberIds).size !== memberIds.length) throw new Error('A person can be in a share once.')
  const shares = draft.shares.map((share) => {
    if (draft.method === 'equal') return Object.freeze({ memberId: share.memberId })
    if (draft.method === 'amounts') {
      if (share.amount === undefined || !Number.isFinite(share.amount) || share.amount <= 0) throw new Error('Every amount must be positive.')
      return Object.freeze({ memberId: share.memberId, amount: share.amount })
    }
    if (share.percentage === undefined || !Number.isFinite(share.percentage) || share.percentage <= 0 || share.percentage > 100) {
      throw new Error('Every percentage must be more than 0 and at most 100.')
    }
    return Object.freeze({ memberId: share.memberId, percentage: share.percentage })
  })
  return Object.freeze({
    transactionId: pathId(draft.transactionId),
    paidByMemberId: pathId(draft.paidByMemberId),
    method: draft.method,
    shares: Object.freeze(shares),
  })
}

export type RecordSettlementDraft = Readonly<{
  fromMemberId: number
  toMemberId: number
  /** A dot decimal, positive, at most four decimals. */
  amount: string
  settledOn: string
  currencyCode: string
  notes: string
  transactionId: number | null
}>
export type RecordSettlementPayload = Readonly<{
  fromMemberId: number
  toMemberId: number
  amount: number
  settledOn: string
  currencyCode: string
  notes: string | null
  transactionId: number | null
}>

const SETTLEMENT_AMOUNT = /^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/

export function freezeRecordSettlement(draft: RecordSettlementDraft): RecordSettlementPayload {
  const fromMemberId = pathId(draft.fromMemberId)
  const toMemberId = pathId(draft.toMemberId)
  if (fromMemberId === toMemberId) throw new Error('Someone cannot pay themselves back.')
  const text = draft.amount.trim()
  if (!SETTLEMENT_AMOUNT.test(text)) throw new Error('The amount must be a positive decimal with at most 4 decimals.')
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('The amount must be more than zero.')
  const notes = draft.notes.trim()
  if (notes.length > SETTLEMENT_NOTES_MAX) throw new Error('The notes are too long.')
  return Object.freeze({
    fromMemberId,
    toMemberId,
    amount,
    settledOn: isoDay.parse(draft.settledOn),
    currencyCode: currencyCode.parse(draft.currencyCode),
    notes: notes === '' ? null : notes,
    transactionId: draft.transactionId === null ? null : pathId(draft.transactionId),
  })
}

/** The API's reasons for refusing a group write (`ERROR_CODE` in the API). */
export const EXPENSE_GROUP_ERROR_CODES = [
  'transaction_in_expense_group',
  'expense_group_shares_invalid',
  'expense_group_transaction_conflict',
  'expense_group_settlement_invalid',
  'expense_group_currency_mismatch',
  'expense_group_amount_exceeded',
  'expense_group_member_invalid',
  'expense_group_member_in_use',
  'expense_group_not_empty',
] as const
export type ExpenseGroupErrorCode = (typeof EXPENSE_GROUP_ERROR_CODES)[number]

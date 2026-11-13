import type { HouseholdResponseDto } from '@/features/household/household-contract'
import { amountToUnits, decimalToUnits, formatUnitsForInput, splitTotalUnits, unitsToDecimal } from '@/features/transactions/transactions-split-view-model'
import type { TransactionViewModel } from '@/features/transactions/transactions-view-model'
import { ApiError } from '@/lib/api/errors'
import { formatNumberInput, parseAmountInput } from '@/lib/formatters/decimal-input'

import type {
  ExpenseGroupDto,
  ExpenseGroupMemberDto,
  GroupExpenseDto,
  ShareLinePayload,
  SplitMethod,
  SuggestedPaymentDto,
} from './expense-groups-contract'

/**
 * What the group screens decide: how a transaction's amount is shared out before it is sent (the
 * same arithmetic the API applies, so the preview is what will be saved), what is left to assign,
 * how a balance or a payment is worded, and how a refused change is explained.
 *
 * Money is counted in the split editor's exact units of 0.0001, as bigints; percentages in
 * hundredths of a percent (100% is 10000), so "remaining" is never off by a float.
 */

const UNIT = 10_000n
const CENT = UNIT / 100n
/** 100% in hundredths of a percent. */
export const WHOLE_PERCENT = 10_000n

const abs = (value: bigint) => (value < 0n ? -value : value)
/** `numerator / denominator` rounded half up, both non-negative. */
const roundDiv = (numerator: bigint, denominator: bigint) => (2n * numerator + denominator) / (2n * denominator)

// ---------------------------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------------------------

/** One person in the share editor; `value` is what they typed (unused for equal shares). */
export type ShareDraftLine = Readonly<{ memberId: number; value: string }>

export type ShareLineError = 'invalid' | 'too-precise' | 'zero' | 'over-100'

export type ShareLineResult = Readonly<{
  /** The person's share as a magnitude in units, or null when it cannot be worked out yet. */
  units: bigint | null
  /** Percentages only: the typed percentage in hundredths. */
  percent: bigint | null
  error: ShareLineError | null
}>

export type SharePreviewProblem = 'no-amount' | 'no-people' | 'line-errors' | 'unassigned' | 'over-assigned' | 'zero-share'

export type SharePreview = Readonly<{
  lines: readonly ShareLineResult[]
  /**
   * What is left to assign: units of money for amounts, hundredths of a percent for
   * percentages, always 0 for equal shares. Negative when the lines add up to more.
   */
  remaining: bigint
  problem: SharePreviewProblem | null
}>

/** A magnitude typed in the reader's format, in units; a leading sign is ignored. */
function readMagnitude(text: string, locale: string): Readonly<{ units: bigint | null; error: ShareLineError | null }> {
  const trimmed = text.trim().replace(/\s*%$/, '')
  if (trimmed === '') return { units: null, error: null }
  const parsed = parseAmountInput(trimmed, locale)
  if (parsed === null) return { units: null, error: 'invalid' }
  const units = decimalToUnits(parsed.replace(/^[-+]/, ''))
  if (units === null) return { units: null, error: 'too-precise' }
  if (units === 0n) return { units: null, error: 'zero' }
  return { units, error: null }
}

/**
 * Shares `magnitude` by `weights` as the API does (`allocateProRata`): each share rounded half up
 * to cents, and the remainder on the largest weight, the first of equals.
 */
export function allocateByWeights(magnitude: bigint, weights: readonly bigint[]): bigint[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (weights.length === 0 || total === 0n) return weights.map(() => 0n)
  const shares = weights.map((weight) => roundDiv(magnitude * weight, total * CENT) * CENT)
  let largest = 0
  weights.forEach((weight, index) => { if (weight > weights[largest]!) largest = index })
  const others = shares.reduce((sum, share, index) => (index === largest ? sum : sum + share), 0n)
  shares[largest] = magnitude - others
  return shares
}

/**
 * The live preview of sharing `totalUnits` (the transaction's signed amount) between `lines`:
 *
 * - **equal**: the amount over the people, rounded to cents, the remainder on the first person;
 * - **amounts**: positive amounts, at most four decimals, adding up to the whole amount;
 * - **percentages**: each more than 0 with at most two decimals, together exactly 100; each share
 *   rounded to cents and the remainder on the largest percentage.
 *
 * No share may come out at zero.
 */
export function previewShares(method: SplitMethod, totalUnits: bigint | null, lines: readonly ShareDraftLine[], locale: string): SharePreview {
  const magnitude = totalUnits === null ? 0n : abs(totalUnits)
  const empty = (problem: SharePreviewProblem): SharePreview => ({ lines: lines.map(() => ({ units: null, percent: null, error: null })), remaining: 0n, problem })
  if (magnitude === 0n) return empty('no-amount')
  if (lines.length === 0) return empty('no-people')

  if (method === 'equal') {
    const units = allocateByWeights(magnitude, lines.map(() => 1n))
    return {
      lines: units.map((value) => ({ units: value, percent: null, error: null })),
      remaining: 0n,
      problem: units.some((value) => value <= 0n) ? 'zero-share' : null,
    }
  }

  if (method === 'amounts') {
    const results = lines.map((line) => {
      const read = readMagnitude(line.value, locale)
      return { units: read.units, percent: null, error: read.error }
    })
    const assigned = results.reduce((sum, line) => sum + (line.units ?? 0n), 0n)
    const remaining = magnitude - assigned
    return { lines: results, remaining, problem: problemOf(results, remaining) }
  }

  const percents = lines.map((line): Readonly<{ percent: bigint | null; error: ShareLineError | null }> => {
    const read = readMagnitude(line.value, locale)
    if (read.units === null) return { percent: null, error: read.error }
    // Two decimals at most: 12.345% is refused, as the API refuses it.
    if (read.units % 100n !== 0n) return { percent: null, error: 'too-precise' }
    const percent = read.units / 100n
    if (percent > WHOLE_PERCENT) return { percent: null, error: 'over-100' }
    return { percent, error: null }
  })
  const assigned = percents.reduce((sum, line) => sum + (line.percent ?? 0n), 0n)
  const remaining = WHOLE_PERCENT - assigned
  const readable = percents.every((line) => line.percent !== null)
  const units = readable && remaining === 0n
    ? allocateByWeights(magnitude, percents.map((line) => line.percent!))
    : percents.map((line) => (line.percent === null ? null : roundDiv(magnitude * line.percent, WHOLE_PERCENT * CENT) * CENT))
  const results = percents.map((line, index) => ({ units: units[index] ?? null, percent: line.percent, error: line.error }))
  return { lines: results, remaining, problem: problemOf(results, remaining) }
}

function problemOf(results: readonly ShareLineResult[], remaining: bigint): SharePreviewProblem | null {
  if (results.some((line) => line.error !== null || (line.units === null && line.percent === null))) return 'line-errors'
  if (remaining > 0n) return 'unassigned'
  if (remaining < 0n) return 'over-assigned'
  if (results.some((line) => line.units !== null && line.units <= 0n)) return 'zero-share'
  return null
}

/** Hundredths of a percent as a canonical decimal ("33.5"). */
export function percentToDecimal(hundredths: bigint): string {
  const integer = hundredths / 100n
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : `${integer}`
}

/** The `shares` of `POST .../shares`; call only when `previewShares` reports no problem. */
export function toShareLines(method: SplitMethod, lines: readonly ShareDraftLine[], preview: SharePreview): ShareLinePayload[] {
  return lines.map((line, index) => {
    const result = preview.lines[index]
    if (method === 'equal') return { memberId: line.memberId }
    if (method === 'amounts') {
      if (!result || result.units === null) throw new Error('A share has no amount.')
      return { memberId: line.memberId, amount: Number(unitsToDecimal(result.units)) }
    }
    if (!result || result.percent === null) throw new Error('A share has no percentage.')
    return { memberId: line.memberId, percentage: Number(percentToDecimal(result.percent)) }
  })
}

/** Whether "Split with group" is offered: a persisted, ordinary row with an amount. */
export function canSplitWithGroup(transaction: TransactionViewModel): boolean {
  return !transaction.synthetic
    && Number.isSafeInteger(transaction.id) && transaction.id > 0
    && !transaction.isTransfer
    && !transaction.repayment
    && transaction.reimbursements.length === 0
    && splitTotalUnits(transaction) !== null
}

export type TransactionGroupShare = Readonly<{
  expenseGroupKey: number
  shares: readonly Readonly<{ memberKey: number; name: string; isHouseholdMember: boolean; amount: number }>[]
}>

/** The group a transaction is shared in, from its split lines, or null when it is not shared. */
export function groupShareOf(transaction: Pick<TransactionViewModel, 'splits'>): TransactionGroupShare | null {
  const lines = transaction.splits.filter((line) => line.expenseGroupMember)
  const first = lines[0]?.expenseGroupMember
  if (!first) return null
  return {
    expenseGroupKey: first.expenseGroupKey,
    shares: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        memberKey: line.expenseGroupMember!.expenseGroupMemberKey,
        name: line.expenseGroupMember!.name,
        isHouseholdMember: line.expenseGroupMember!.isHouseholdMember,
        amount: line.amount,
      })),
  }
}

/** The people who can pay: someone of the household (the money left one of its accounts). */
export function payerOptions(members: readonly ExpenseGroupMemberDto[]): ExpenseGroupMemberDto[] {
  return members.filter((member) => member.isHouseholdMember)
}

/** The payer a new share starts with: the reader, else the first person of the household. */
export function defaultPayer(members: readonly ExpenseGroupMemberDto[]): number | null {
  const payers = payerOptions(members)
  return (payers.find((member) => member.isYou) ?? payers[0])?.expenseGroupMemberKey ?? null
}

export type ShareDraft = Readonly<{
  method: SplitMethod
  paidByMemberId: number | null
  /** Who is in the share, in the group's order. */
  memberIds: readonly number[]
  /** What was typed per person (amounts or percentages), by member key. */
  values: Readonly<Record<number, string>>
}>

/** A new share: everyone in the group, equally, paid by the reader. */
export function startShareDraft(group: Pick<ExpenseGroupDto, 'members'>): ShareDraft {
  return {
    method: 'equal',
    paidByMemberId: defaultPayer(group.members),
    memberIds: [...group.members].sort((a, b) => a.position - b.position).map((member) => member.expenseGroupMemberKey),
    values: {},
  }
}

/**
 * An existing share as an editable draft. The API keeps amounts, not percentages, so a share made
 * by percentages comes back as each amount's part of the whole (to two decimals, the last
 * hundredth on the largest so they make 100). A method this build does not know is edited as amounts.
 */
export function draftFromExpense(expense: GroupExpenseDto, locale: string): ShareDraft {
  const method: SplitMethod = expense.splitMethod === 'unknown' ? 'amounts' : expense.splitMethod
  const memberIds = expense.shares.map((share) => share.expenseGroupMemberKey)
  const magnitudes = expense.shares.map((share) => abs(amountToUnits(share.amount)))
  const values: Record<number, string> = {}
  if (method === 'amounts') {
    expense.shares.forEach((share, index) => { values[share.expenseGroupMemberKey] = formatUnitsForInput(magnitudes[index]!, locale) })
  } else if (method === 'percentages') {
    const total = magnitudes.reduce((sum, value) => sum + value, 0n)
    if (total > 0n) {
      const percents = magnitudes.map((value) => roundDiv(value * WHOLE_PERCENT, total))
      let largest = 0
      magnitudes.forEach((value, index) => { if (value > magnitudes[largest]!) largest = index })
      percents[largest] = WHOLE_PERCENT - percents.reduce((sum, value, index) => (index === largest ? sum : sum + value), 0n)
      expense.shares.forEach((share, index) => { values[share.expenseGroupMemberKey] = formatNumberInput(percentToDecimal(percents[index]!), locale) })
    }
  }
  return { method, paidByMemberId: expense.paidByMemberKey, memberIds, values }
}

// ---------------------------------------------------------------------------------------------
// Balances and wording
// ---------------------------------------------------------------------------------------------

export type BalanceStanding = 'owed' | 'owes' | 'settled'

/** Positive: the group owes them; negative: they owe; under a cent either way reads as settled. */
export function balanceStanding(balance: number): BalanceStanding {
  const units = amountToUnits(balance)
  if (abs(units) < CENT) return 'settled'
  return units > 0n ? 'owed' : 'owes'
}

export type PaymentWording = Readonly<{
  /** `you-owe`: "You owe Rui"; `owes-you`: "Sam owes you"; `owes`: "Sam owes Rui". */
  kind: 'you-owe' | 'owes-you' | 'owes'
  from: string
  to: string
}>

export function memberName(members: readonly ExpenseGroupMemberDto[], memberKey: number, fallback: string): string {
  return members.find((member) => member.expenseGroupMemberKey === memberKey)?.name.trim() || fallback
}

/** A suggested payment in "X owes Y" terms, naming the reader as "you". */
export function describePayment(payment: Pick<SuggestedPaymentDto, 'fromMemberKey' | 'toMemberKey'>, members: readonly ExpenseGroupMemberDto[], fallback: string): PaymentWording {
  const from = members.find((member) => member.expenseGroupMemberKey === payment.fromMemberKey)
  const to = members.find((member) => member.expenseGroupMemberKey === payment.toMemberKey)
  const kind = from?.isYou ? 'you-owe' : to?.isYou ? 'owes-you' : 'owes'
  return { kind, from: from?.name.trim() || fallback, to: to?.name.trim() || fallback }
}

export type YourBalance = Readonly<{ currencyCode: string; amount: number; standing: Exclude<BalanceStanding, 'settled'> }>

/** The reader's standing per currency in a group, leaving out currencies they are square in. */
export function yourBalances(group: Pick<ExpenseGroupDto, 'yourBalances'>): YourBalance[] {
  return group.yourBalances.flatMap((entry) => {
    const standing = balanceStanding(entry.amount)
    return standing === 'settled' ? [] : [{ currencyCode: entry.currencyCode, amount: Math.abs(entry.amount), standing }]
  })
}

/** A settlement can name a transaction only between someone of the household and someone outside it. */
export function canLinkSettlement(members: readonly ExpenseGroupMemberDto[], fromMemberKey: number | null, toMemberKey: number | null): boolean {
  if (fromMemberKey === null || toMemberKey === null || fromMemberKey === toMemberKey) return false
  const from = members.find((member) => member.expenseGroupMemberKey === fromMemberKey)
  const to = members.find((member) => member.expenseGroupMemberKey === toMemberKey)
  if (!from || !to) return false
  return from.isHouseholdMember !== to.isHouseholdMember
}

export type SettlementAmountError = 'invalid' | 'too-precise' | 'zero' | 'over'
export type SettlementAmountResult = Readonly<{ units: bigint | null; error: SettlementAmountError | null }>

/** Reads a settlement's amount as a positive magnitude; more than `capUnits` (a linked transaction's remainder) is over. */
export function readSettlementAmount(input: string, locale: string, capUnits: bigint | null = null): SettlementAmountResult {
  const read = readMagnitude(input, locale)
  if (read.error === 'over-100') return { units: null, error: 'invalid' }
  if (read.error) return { units: null, error: read.error }
  if (read.units === null) return { units: null, error: null }
  if (capUnits !== null && read.units > capUnits) return { units: read.units, error: 'over' }
  return { units: read.units, error: null }
}

/** Whether the reader is a household viewer, who sees groups but changes nothing. */
export function isHouseholdViewer(household: HouseholdResponseDto | null | undefined): boolean {
  if (!household || household.viewerAppuserKey === null) return false
  return household.members.find((member) => member.appuserKey === household.viewerAppuserKey)?.role === 'viewer'
}

/** The household's other members, who can be added to a group as themselves. */
export function householdCandidates(household: HouseholdResponseDto | null | undefined, group?: Pick<ExpenseGroupDto, 'members'>): Readonly<{ appuserKey: number; name: string }>[] {
  if (!household) return []
  const taken = new Set(group?.members.map((member) => member.appuserKey).filter((key): key is number => key !== null) ?? [])
  return household.members
    .filter((member) => member.appuserKey !== household.viewerAppuserKey && !taken.has(member.appuserKey))
    .map((member) => ({ appuserKey: member.appuserKey, name: member.firstName?.trim() || member.emailAddress }))
}

// ---------------------------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------------------------

export type ExpenseGroupFailure =
  | 'in-group'
  | 'shares-invalid'
  | 'transaction-conflict'
  | 'settlement-invalid'
  | 'currency-mismatch'
  | 'amount-exceeded'
  | 'member-invalid'
  | 'member-in-use'
  | 'not-empty'
  | 'not-found'
  | 'demo' | 'read-only' | 'account-read-only'
  | 'mfa'
  | 'cancelled'
  | 'network'
  | 'error'

const SERVER_FAILURES: Readonly<Record<string, ExpenseGroupFailure>> = {
  transaction_in_expense_group: 'in-group',
  expense_group_shares_invalid: 'shares-invalid',
  expense_group_transaction_conflict: 'transaction-conflict',
  expense_group_settlement_invalid: 'settlement-invalid',
  expense_group_currency_mismatch: 'currency-mismatch',
  expense_group_amount_exceeded: 'amount-exceeded',
  expense_group_member_invalid: 'member-invalid',
  expense_group_member_in_use: 'member-in-use',
  expense_group_not_empty: 'not-empty',
  not_found: 'not-found',
}

/** Why a group write was refused, in the terms the screens word (`expenseGroups.errors.*`). */
export function classifyGroupFailure(error: unknown): ExpenseGroupFailure {
  if (!(error instanceof ApiError)) return 'error'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'account-read-only') return 'account-read-only'
  if (error.code === 'mfa-required') return 'mfa'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network'
  if (error.code !== 'http') return 'error'
  const known = error.serverCode ? SERVER_FAILURES[error.serverCode] : undefined
  if (known) return known
  if (error.status === 404) return 'not-found'
  return 'error'
}

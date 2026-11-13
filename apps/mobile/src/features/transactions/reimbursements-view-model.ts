import { ApiError } from '@/lib/api/errors'
import { parseAmountInput } from '@/lib/formatters/decimal-input'

import type { LinkedTransactionDto, ReimbursementLinkDto } from './reimbursements-contract'
import { amountToUnits, decimalToUnits } from './transactions-split-view-model'
import type { TransactionViewModel } from './transactions-view-model'

/**
 * What the reimbursement screens decide: which rows take part, what their badge says, the amount
 * a link defaults to, and how a refused change is worded. Money is counted in the split editor's
 * exact units of 0.0001 (the API stores four decimals), so "what is left" is never off by a float.
 */

export type ReimbursementRole = 'expense' | 'reimbursement'

/** By the amount's sign, as the API decides it: money out is an expense, money in a reimbursement. */
export function reimbursementRoleOf(transaction: Pick<TransactionViewModel, 'direction'>): ReimbursementRole | null {
  if (transaction.direction === 'debit') return 'expense'
  if (transaction.direction === 'credit') return 'reimbursement'
  return null
}

/**
 * "Mark as reimbursement" is offered on ordinary money in: a real row (not the opening balance),
 * with an amount, that is not a transfer between the household's own money or a loan repayment,
 * which the API refuses (`reimbursement_invalid`).
 */
export function canMarkAsReimbursement(transaction: TransactionViewModel): boolean {
  return !transaction.synthetic
    && Number.isSafeInteger(transaction.id) && transaction.id > 0
    && transaction.direction === 'credit'
    && !transaction.isTransfer
    && !transaction.repayment
    && transaction.settlementAmount !== null && transaction.settlementAmount > 0
}

export type ReimbursementBadge = 'reimbursed' | 'partly-reimbursed' | 'reimbursement'

/**
 * The row's badge: an expense with links is reimbursed, wholly once the links cover its amount;
 * money in with links is a reimbursement. No links, no badge.
 */
export function reimbursementBadge(transaction: TransactionViewModel): ReimbursementBadge | null {
  if (transaction.reimbursements.length === 0) return null
  const role = reimbursementRoleOf(transaction)
  if (role === 'reimbursement') return 'reimbursement'
  if (role !== 'expense') return null
  if (transaction.settlementAmount === null) return 'reimbursed'
  const linked = transaction.reimbursements.reduce((sum, link) => sum + amountToUnits(link.amount), 0n)
  return linked >= amountToUnits(transaction.settlementAmount) ? 'reimbursed' : 'partly-reimbursed'
}

/** The side of `link` that is not `transactionId`. */
export function linkedSide(link: ReimbursementLinkDto, transactionId: number): LinkedTransactionDto {
  return link.expense.transactionKey === transactionId ? link.reimbursement : link.expense
}

/** How the other side is named: its merchant, else its description. */
export function linkedTitle(transaction: Pick<LinkedTransactionDto, 'merchantName' | 'description'>): string | null {
  return transaction.merchantName?.trim() || transaction.description?.trim() || null
}

/** What a new link defaults to: what is left of this refund or of the chosen expense, whichever is less. */
export function defaultLinkAmountUnits(remainingThis: number, remainingExpense: number): bigint {
  const left = amountToUnits(Math.max(0, remainingThis))
  const right = amountToUnits(Math.max(0, remainingExpense))
  return left < right ? left : right
}

export type LinkAmountError = 'invalid' | 'too-precise' | 'zero' | 'over'
export type LinkAmountResult = Readonly<{ units: bigint | null; error: LinkAmountError | null }>

/**
 * Reads the typed amount in the reader's number format, as a positive magnitude. Blank is no
 * amount yet; more than `capUnits` (what is left on both sides) is over, and keeps its units so the
 * screen can still say by how much.
 */
export function readLinkAmount(input: string, capUnits: bigint, locale: string): LinkAmountResult {
  const text = input.trim()
  if (text === '') return { units: null, error: null }
  const parsed = parseAmountInput(text, locale)
  if (parsed === null) return { units: null, error: 'invalid' }
  const units = decimalToUnits(parsed.replace(/^[-+]/, ''))
  if (units === null) return { units: null, error: 'too-precise' }
  if (units === 0n) return { units: null, error: 'zero' }
  if (units > capUnits) return { units, error: 'over' }
  return { units, error: null }
}

export type ReimbursementFailure =
  | 'currency-mismatch'
  | 'amount-exceeded'
  | 'visibility-mismatch'
  | 'invalid'
  | 'exists'
  | 'not-found'
  | 'demo' | 'read-only' | 'account-read-only'
  | 'mfa'
  | 'cancelled'
  | 'network'
  | 'error'

const SERVER_FAILURES: Readonly<Record<string, ReimbursementFailure>> = {
  reimbursement_currency_mismatch: 'currency-mismatch',
  reimbursement_amount_exceeded: 'amount-exceeded',
  reimbursement_visibility_mismatch: 'visibility-mismatch',
  reimbursement_invalid: 'invalid',
  reimbursement_link_exists: 'exists',
  not_found: 'not-found',
}

/** Why a link or unlink was refused, in the terms the screens word (`transactions.reimbursement.errors.*`). */
export function classifyReimbursementFailure(error: unknown): ReimbursementFailure {
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
  if (error.status === 409) return 'exists'
  return 'error'
}

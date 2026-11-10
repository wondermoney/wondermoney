import type { TFunction } from 'i18next'

import { transactionDirection } from './manual-transaction-contract'

export const knownManualTransactionTypes = [
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'PAYMENT',
  'TOPUP',
  'CARD_PAYMENT',
  'EXCHANGE',
  'ATM',
  'DEPOSIT',
  'LOAN',
  'REVERT',
  'REWARD',
  'CASHBACK',
  'CARD_REFUND',
  'FEE',
] as const

const knownTypes = new Set<string>(knownManualTransactionTypes)

export function formatManualTransactionType(t: TFunction, value: string): string {
  const normalized = value.trim().toUpperCase()
  const readable = normalized.replaceAll('_', ' ').toLocaleLowerCase()
  return knownTypes.has(normalized)
    ? t(`transactionCreate.types.${normalized.toLocaleLowerCase()}`)
    : t('transactionCreate.types.unknown', { type: readable || t('transactions.unavailable') })
}

/** The three kinds the add form leads with; the server's types sort under them. */
export type ManualTransactionKind = 'expense' | 'income' | 'transfer'
export const manualTransactionKinds: readonly ManualTransactionKind[] = ['expense', 'income', 'transfer']

const TRANSFER_TYPES = new Set(['TRANSFER_IN', 'TRANSFER_OUT'])
/** The type each kind starts on, in order of preference; the first one the server offers wins. */
const PREFERRED: Record<ManualTransactionKind, readonly string[]> = {
  expense: ['CARD_PAYMENT', 'PAYMENT'],
  income: ['DEPOSIT', 'TOPUP'],
  transfer: ['TRANSFER_OUT', 'TRANSFER_IN'],
}

/**
 * Sorts a server transaction type under Expense, Income or Transfer. The two
 * transfer types are Transfer; everything else follows the direction the
 * server applies (`transactionDirection`): money out is an expense, money in
 * (deposit, refund, cashback, reward, exchange, reversal) is income.
 */
export function manualTransactionKind(typeName: string): ManualTransactionKind {
  const normalized = typeName.trim().toUpperCase()
  if (TRANSFER_TYPES.has(normalized)) return 'transfer'
  return transactionDirection(normalized) === 'debit' ? 'expense' : 'income'
}

/** The types under one kind, in the server's order. */
export function typesOfKind<T extends { name: string }>(types: readonly T[], kind: ManualTransactionKind): T[] {
  return types.filter((type) => manualTransactionKind(type.name) === kind)
}

/** The type a kind starts on: the preferred one if the server offers it, else the kind's first. */
export function defaultTypeOfKind<T extends { name: string }>(types: readonly T[], kind: ManualTransactionKind): T | null {
  const candidates = typesOfKind(types, kind)
  for (const name of PREFERRED[kind]) {
    const match = candidates.find((type) => type.name.trim().toUpperCase() === name)
    if (match) return match
  }
  return candidates[0] ?? null
}

import type { TFunction } from 'i18next'

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

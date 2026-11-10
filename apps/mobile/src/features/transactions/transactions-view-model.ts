import type { EntityMarkSource } from '@/components/ui/entity-mark'
import type { TagDto } from '@/features/tags/tags-contract'

import { transactionMark } from './transaction-mark'
import { isTransferType, type TransactionDto } from './transactions-contract'

export type TransactionViewModel = Readonly<{
  id: number
  date: string
  title: string | null
  description: string | null
  rawDescription: string | null
  merchant: string | null
  accountId: number
  accountName: string | null
  type: string | null
  direction: 'credit' | 'debit' | 'unknown'
  isCredit: boolean
  amount: number | null
  currency: string | null
  settlementAmount: number | null
  settlementCurrency: string | null
  balance: number | null
  balanceCurrency: string | null
  convertedBalance: number | null
  convertedBalanceCurrency: string | null
  category: string | null
  /** False when the row's category is one that does not count as spending (investments, savings). */
  categoryCountsAsSpending: boolean
  /** Typed as a transfer between the household's own money: left out of spending and income. */
  isTransfer: boolean
  /** Where an outgoing transfer went, when someone said so. */
  transferDestination: NonNullable<TransactionDto['transferDestination']> | null
  /** The household tags on the row, by name; empty when the server sent none. */
  tags: readonly TagDto[]
  reviewed: boolean
  hidden: boolean
  recurring: TransactionDto['recurringSeries']
  repayment: TransactionDto['loanRepayment']
  synthetic: boolean
  /** The row's lead mark: category, transfer arrows, or the institution on the opening row. */
  mark?: EntityMarkSource
}>

/**
 * Keeps the server's order, as web does: the API sorts by date and key, newest
 * first, with the synthetic "Initial balance" rows at their account's creation
 * date.
 */
export function mapTransactions(input: { transactions: readonly TransactionDto[] }): TransactionViewModel[] {
  return input.transactions.map((transaction) => {
    const type = transaction.transactionTypeKey?.name ?? null
    const normalizedType = type?.toLowerCase()
    const primaryAmount = transaction.appuserSettlementAmount ?? null
    const fallbackDirection: TransactionViewModel['direction'] = normalizedType === 'credit'
      ? 'credit'
      : normalizedType === 'debit' ? 'debit' : 'unknown'
    const direction: TransactionViewModel['direction'] = primaryAmount === null || primaryAmount === 0
      ? fallbackDirection
      : primaryAmount > 0 ? 'credit' : 'debit'
    const isCredit = direction === 'credit'
    return {
      id: transaction.transactionKey,
      date: transaction.transactionDate,
      title: transaction.transactionMerchantKey?.name ?? transaction.description ?? null,
      description: transaction.description ?? null,
      rawDescription: transaction.descriptionDirty ?? transaction.description ?? null,
      merchant: transaction.transactionMerchantKey?.name ?? null,
      accountId: transaction.accountKey.accountKey,
      accountName: transaction.accountKey.accountName ?? null,
      type,
      direction,
      isCredit,
      amount: primaryAmount,
      currency: transaction.appuserCurrencyKey?.code ?? null,
      settlementAmount: transaction.editedSettlementAmount != null
        ? Math.abs(transaction.editedSettlementAmount)
        : transaction.settlementAmount == null ? null : Math.abs(transaction.settlementAmount),
      settlementCurrency: transaction.settlementCurrencyKey?.code ?? null,
      balance: transaction.balance ?? null,
      balanceCurrency: transaction.accountKey.currencyKey.code,
      convertedBalance: transaction.appuserCurrencyBalance ?? null,
      convertedBalanceCurrency: transaction.appuserCurrencyKey?.code ?? null,
      category: transaction.appuserTransactionCategories[0]?.name ?? null,
      categoryCountsAsSpending: transaction.appuserTransactionCategories[0]?.countsAsSpending !== false,
      isTransfer: isTransferType(type),
      transferDestination: transaction.transferDestination ?? null,
      tags: transaction.tags ?? [],
      reviewed: transaction.reviewed,
      hidden: transaction.hidden ?? false,
      recurring: transaction.recurringSeries,
      repayment: transaction.loanRepayment,
      synthetic: transaction.transactionKey < 0,
      mark: transactionMark({
        synthetic: transaction.transactionKey < 0,
        type,
        category: categoryOf(transaction.appuserTransactionCategories[0]),
        institutionLogoUrl: transaction.accountKey.accountFinancialInstitutionKey?.logoUrl ?? null,
      }),
    }
  })
}

function categoryOf(category: TransactionDto['appuserTransactionCategories'][number] | undefined) {
  return category ? { name: category.icon ?? null, bgColor: category.bgColor ?? null, textColor: category.textColor ?? null } : null
}

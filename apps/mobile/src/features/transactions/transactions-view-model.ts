import type { EntityMarkSource } from '@/components/ui/entity-mark'
import type { TagDto } from '@/features/tags/tags-contract'
import { type FxState, resolveFxState } from '@/lib/api/fx-status'

import { transactionMark } from './transaction-mark'
import { isTransferType, type TransactionDto, type TransactionInstallmentDto, type TransactionSplitLineDto } from './transactions-contract'

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
  /** The category's key, for pre-filling a rule's "set category" action. */
  categoryId: number | null
  /** False when the row's category is one that does not count as spending (investments, savings). */
  categoryCountsAsSpending: boolean
  /** Typed as a transfer between the household's own money: left out of spending and income. */
  isTransfer: boolean
  /** Where an outgoing transfer went, when someone said so. */
  transferDestination: NonNullable<TransactionDto['transferDestination']> | null
  /** The household tags on the row, by name; empty when the server sent none. */
  tags: readonly TagDto[]
  /** The split's lines, in the API's order; empty when the row is not split. */
  splits: readonly TransactionSplitLineDto[]
  /** The row's amount is shared over several categories. */
  isSplit: boolean
  /** The installment of a plan this posted row was linked to ("3/12"), when it is one. */
  installment: TransactionInstallmentDto | null
  reviewed: boolean
  hidden: boolean
  /** The bank sent it: it can be hidden, never deleted. */
  bankSynced: boolean
  recurring: TransactionDto['recurringSeries']
  repayment: TransactionDto['loanRepayment']
  synthetic: boolean
  /** The row's lead mark: category, transfer arrows, or the institution on the opening row. */
  mark?: EntityMarkSource
  /**
   * How `amount` was converted. `missing`: there is no `amount`; show the original (signed) one it
   * carries, marked "Not converted". `provisional`: `amount` is an estimate at an older rate.
   */
  fx: FxState
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
    const fx = resolveFxState({
      fxStatus: transaction.fxStatus,
      fxRateDate: transaction.fxRateDate,
      converted: primaryAmount,
      original: transaction.editedSettlementAmount ?? transaction.settlementAmount,
      fromCurrency: transaction.settlementCurrencyKey?.code,
      toCurrency: transaction.appuserCurrencyKey?.code,
    })
    // A row with no converted amount still has a sign: its original amount's.
    const signedAmount = primaryAmount ?? (fx.status === 'missing' ? fx.amount : null)
    const fallbackDirection: TransactionViewModel['direction'] = normalizedType === 'credit'
      ? 'credit'
      : normalizedType === 'debit' ? 'debit' : 'unknown'
    const direction: TransactionViewModel['direction'] = signedAmount === null || signedAmount === 0
      ? fallbackDirection
      : signedAmount > 0 ? 'credit' : 'debit'
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
      categoryId: transaction.appuserTransactionCategories[0]?.categoryKey ?? null,
      categoryCountsAsSpending: transaction.appuserTransactionCategories[0]?.countsAsSpending !== false,
      isTransfer: isTransferType(type),
      transferDestination: transaction.transferDestination ?? null,
      tags: transaction.tags ?? [],
      splits: transaction.splits ?? [],
      isSplit: (transaction.splits?.length ?? 0) > 0,
      installment: transaction.installment ?? null,
      reviewed: transaction.reviewed,
      hidden: transaction.hidden ?? false,
      bankSynced: transaction.bankSynced === true,
      recurring: transaction.recurringSeries,
      repayment: transaction.loanRepayment,
      synthetic: transaction.transactionKey < 0,
      mark: transactionMark({
        synthetic: transaction.transactionKey < 0,
        type,
        category: categoryOf(transaction.appuserTransactionCategories[0]),
        institutionLogoUrl: transaction.accountKey.accountFinancialInstitutionKey?.logoUrl ?? null,
      }),
      fx,
    }
  })
}

function categoryOf(category: TransactionDto['appuserTransactionCategories'][number] | undefined) {
  return category ? { name: category.icon ?? null, bgColor: category.bgColor ?? null, textColor: category.textColor ?? null } : null
}

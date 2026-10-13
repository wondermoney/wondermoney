import type { TransactionDto } from './transactions-contract'

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
  reviewed: boolean
  hidden: boolean
  recurring: TransactionDto['recurringSeries']
  repayment: TransactionDto['loanRepayment']
  synthetic: boolean
}>

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
      reviewed: transaction.reviewed,
      hidden: transaction.hidden ?? false,
      recurring: transaction.recurringSeries,
      repayment: transaction.loanRepayment,
      synthetic: transaction.transactionKey < 0,
    }
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
}

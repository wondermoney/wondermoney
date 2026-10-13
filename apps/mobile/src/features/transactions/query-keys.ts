import type { TransactionFilters } from './transactions-contract'

const normalized = (filters: TransactionFilters) => ({
  fromDate: filters.fromDate ?? null,
  toDate: filters.toDate ?? null,
  needsReview: filters.needsReview === true,
  includeHidden: filters.includeHidden === true,
  limit: filters.limit ?? 100,
})

export const transactionsRootKey = (epochId: number) => ['transactions', epochId] as const
export const transactionsKey = (epochId: number, filters: TransactionFilters) => (
  [...transactionsRootKey(epochId), 'aggregate', normalized(filters)] as const
)
export const accountTransactionsKey = (
  epochId: number,
  accountId: number,
  filters: TransactionFilters,
) => [...transactionsRootKey(epochId), 'account', accountId, normalized(filters)] as const
export const recentTransactionsKey = (epochId: number, accountId: number) => (
  [...transactionsRootKey(epochId), 'recent', accountId] as const
)

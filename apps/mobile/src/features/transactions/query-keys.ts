import type { TransactionFilters } from './transactions-contract'

const normalized = (filters: TransactionFilters) => ({
  fromDate: filters.fromDate ?? null,
  toDate: filters.toDate ?? null,
  needsReview: filters.needsReview === true,
  includeHidden: filters.includeHidden === true,
  tagIds: [...(filters.tagIds ?? [])].sort((left, right) => left - right).join(','),
  memberKeys: (filters.memberKeys ?? []).join(','),
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
export const transactionReviewSummaryKey = (epochId: number) => (
  [...transactionsRootKey(epochId), 'review-summary'] as const
)

export const transactionAttachmentsKey = (epochId: number, transactionId: number) => (
  [...transactionsRootKey(epochId), 'attachments', transactionId] as const
)

/** One transaction's reimbursement links; under the transactions root, so a list change refreshes it. */
export const transactionReimbursementsKey = (epochId: number, transactionId: number) => (
  [...transactionsRootKey(epochId), 'reimbursements', transactionId] as const
)
export const reimbursementSuggestionsKey = (epochId: number, transactionId: number, search: string) => (
  [...transactionReimbursementsKey(epochId, transactionId), 'suggestions', search] as const
)

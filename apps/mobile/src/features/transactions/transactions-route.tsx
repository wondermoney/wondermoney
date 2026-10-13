import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { mapCategories } from '@/features/categories/categories-view-model'
import { useCategories } from '@/features/categories/use-categories'
import { ApiError } from '@/lib/api/errors'
import { parseAccountId } from '@/features/accounts/accounts-contract'
import { useAccounts } from '@/features/accounts/use-accounts'
import { useTranslation } from 'react-i18next'

import type { TransactionFilters } from './transactions-contract'
import { TransactionsScreen, type ReviewResult, type TransactionsViewState } from './transactions-screen'
import { mapTransactions } from './transactions-view-model'
import { useEditTransactionAmount } from './use-edit-transaction-amount'
import { useTransactionBulkActions, type TransactionBulkAction } from './use-mark-reviewed'
import { useTransactions } from './use-transactions'

function classifyResult(error: unknown, blockAccess: (state: 'mfa-required') => void): ReviewResult {
  if (!(error instanceof ApiError)) return 'error'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network'
  if (error.code === 'mfa-required') { blockAccess('mfa-required'); return 'mfa' }
  return 'error'
}

export function TransactionsRoute({ perAccount = false }: { perAccount?: boolean }) {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const accountId = perAccount ? parseAccountId(params.accountId) : null
  const [filters, setFilters] = useState<TransactionFilters>({})
  const query = useTransactions(filters, perAccount ? accountId : null)
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()
  const mutation = useTransactionBulkActions()
  const amountMutation = useEditTransactionAmount()
  const { blockAccess } = useProductRuntime()
  const { t, i18n } = useTranslation()
  const router = useRouter()
  let state: TransactionsViewState
  if (query.isInvalidAccountId) state = { status: 'invalid-account' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', transactions: mapTransactions(query.data), refreshing: query.isRefreshing }
  else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const runAction = async (action: TransactionBulkAction): Promise<ReviewResult> => {
    try {
      await mutation.mutateAsync(action)
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  const runAmountEdit = async (transactionId: number, updatedAmount: string, description?: string): Promise<ReviewResult> => {
    try {
      await amountMutation.mutateAsync({ transactionId, updatedAmount, description })
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  const categoryState = categoriesQuery.data
    ? { status: 'loaded' as const, categories: mapCategories(categoriesQuery.data, t, i18n.resolvedLanguage ?? i18n.language) }
    : categoriesQuery.isLoading
      ? { status: 'loading' as const }
      : { status: 'error' as const }

  return <TransactionsScreen
    state={state}
    filters={filters}
    categories={categoryState}
    accountCount={accountsQuery.data?.accounts.length}
    pending={mutation.isPending || amountMutation.isPending}
    accountName={state.status === 'loaded' || state.status === 'refresh-error' ? state.transactions[0]?.accountName : null}
    onBack={() => perAccount && accountId ? router.replace(`/accounts/${accountId}`) : router.replace('/accounts')}
    onCreate={() => router.push({ pathname: '/accounts/transactions/create', ...(accountId ? { params: { accountId: String(accountId) } } : {}) } as Href)}
    onImport={() => router.push({ pathname: '/accounts/transactions/import', ...(accountId ? { params: { accountId: String(accountId) } } : {}) } as Href)}
    onScanReceipt={() => router.push('/accounts/transactions/scan' as Href)}
    onFiltersChange={setFilters}
    onRefresh={async () => { await query.refetch() }}
    onMarkReviewed={(transactionId) => runAction({ type: 'review', transactionIds: [transactionId] })}
    onBulkReview={(transactionIds) => runAction({ type: 'review', transactionIds })}
    onAssignCategory={(transactionIds, categoryId) => runAction({ type: 'category', transactionIds, categoryId })}
    onSetHidden={(transactionIds, hidden) => runAction({ type: hidden ? 'hidden' : 'unhidden', transactionIds })}
    onEditAmount={runAmountEdit}
  />
}

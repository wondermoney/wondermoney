import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { mapCategories } from '@/features/categories/categories-view-model'
import { useCategories } from '@/features/categories/use-categories'
import { useAiHiddenPreference } from '@/features/preferences/use-ai-hidden'
import { toTagsState, useCreateTagForPicker, useSetTransactionTags, useTags } from '@/features/tags/use-tags'
import { ApiError } from '@/lib/api/errors'
import { parseAccountId } from '@/features/accounts/accounts-contract'
import { useAccounts } from '@/features/accounts/use-accounts'
import { useTranslation } from 'react-i18next'

import type { TransactionFilters, TransferEditDraft } from './transactions-contract'
import { DEFAULT_RANGE_DAYS, presetRange } from './transactions-date-range'
import { TransactionsScreen, type ReviewResult, type TransactionsFreshness, type TransactionsViewState } from './transactions-screen'
import { mapTransactions } from './transactions-view-model'
import { useEditTransactionAmount } from './use-edit-transaction-amount'
import { useEditTransactionTransfer } from './use-edit-transaction-transfer'
import { useTransactionBulkActions, type TransactionBulkAction } from './use-mark-reviewed'
import { useTransactions } from './use-transactions'
import { useTransactionsLead } from './use-transactions-lead'
import { useTransferDestinations } from './use-transfer-destinations'

function classifyResult(error: unknown, blockAccess: (state: 'mfa-required') => void): ReviewResult {
  if (!(error instanceof ApiError)) return 'error'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network'
  if (error.code === 'mfa-required') { blockAccess('mfa-required'); return 'mfa' }
  return 'error'
}

export function TransactionsRoute({ perAccount = false }: { perAccount?: boolean }) {
  const params = useLocalSearchParams<{ accountId?: string | string[]; filter?: string | string[] }>()
  const accountId = perAccount ? parseAccountId(params.accountId) : null
  // Home's "Review now" opens the ledger already narrowed to the review inbox, with no date
  // range: an unreviewed row from last year must not be hidden by the list's 60-day default.
  const reviewOnly = !perAccount && (Array.isArray(params.filter) ? params.filter[0] : params.filter) === 'unreviewed'
  // Web opens both ledgers on the last 60 days (`subDays(new Date(), 60)`).
  const [filters, setFilters] = useState<TransactionFilters>(() => reviewOnly ? { limit: 100, needsReview: true } : presetRange(DEFAULT_RANGE_DAYS))
  const query = useTransactions(filters, perAccount ? accountId : null)
  const accountsQuery = useAccounts()
  const lead = useTransactionsLead({ fromDate: filters.fromDate, toDate: filters.toDate }, !perAccount)
  const categoriesQuery = useCategories()
  const mutation = useTransactionBulkActions()
  const amountMutation = useEditTransactionAmount()
  const transferMutation = useEditTransactionTransfer()
  const transferDestinations = useTransferDestinations(accountsQuery.data?.accounts)
  const tagsQuery = useTags()
  const tagsMutation = useSetTransactionTags()
  const createTag = useCreateTagForPicker()
  const { blockAccess } = useProductRuntime()
  const aiHidden = useAiHiddenPreference()
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

  // Only a single-account list names its account. The all-accounts list used to
  // take the first row's account and label the whole ledger with it.
  const accountName = perAccount && accountId !== null
    ? accountsQuery.data?.accounts.find((account) => account.accountKey === accountId)?.accountName
      ?? ('transactions' in state ? state.transactions.find((row) => row.accountId === accountId)?.accountName : null)
      ?? null
    : null

  const accounts = accountsQuery.data?.accounts ?? []
  // Web's AccountsFreshness: the weakest link among the accounts that sync —
  // the oldest refresh, since one stale account means the list is missing its days.
  const refreshed = accounts.map((account) => account.refreshedAt).filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string)))
  const freshness: TransactionsFreshness = refreshed.length === 0 ? null : { kind: 'updated', at: refreshed.reduce((oldest, value) => Date.parse(value) < Date.parse(oldest) ? value : oldest) }
  const leadCurrency = accounts[0]?.accountOwnerAppuserKey?.currencyKey.code ?? null

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

  const runSetTransfer = async (draft: TransferEditDraft): Promise<ReviewResult> => {
    try {
      await transferMutation.mutateAsync(draft)
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  const runSetTags = async (transactionId: number, tagIds: readonly number[]): Promise<ReviewResult> => {
    try {
      await tagsMutation.mutateAsync({ transactionId, tagIds })
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
    total={query.data?.total ?? null}
    hasMore={query.data?.hasMore}
    categories={categoryState}
    accountCount={accountsQuery.data?.accounts.length}
    pending={mutation.isPending || amountMutation.isPending || transferMutation.isPending}
    accountName={accountName}
    perAccount={perAccount}
    lead={perAccount ? undefined : lead}
    leadCurrency={leadCurrency}
    freshness={perAccount ? null : freshness}
    onBack={() => perAccount && accountId ? router.replace(`/accounts/${accountId}`) : router.replace('/accounts')}
    onCreate={() => router.push({ pathname: '/accounts/transactions/create', ...(accountId ? { params: { accountId: String(accountId) } } : {}) } as Href)}
    onImport={() => router.push({ pathname: '/accounts/transactions/import', ...(accountId ? { params: { accountId: String(accountId) } } : {}) } as Href)}
    onScanReceipt={aiHidden ? undefined : () => router.push('/accounts/transactions/scan' as Href)}
    onFiltersChange={setFilters}
    onRefresh={async () => { await query.refetch() }}
    onMarkReviewed={(transactionId) => runAction({ type: 'review', transactionIds: [transactionId] })}
    onBulkReview={(transactionIds) => runAction({ type: 'review', transactionIds })}
    onAssignCategory={(transactionIds, categoryId) => runAction({ type: 'category', transactionIds, categoryId })}
    onSetHidden={(transactionIds, hidden) => runAction({ type: hidden ? 'hidden' : 'unhidden', transactionIds })}
    onEditAmount={runAmountEdit}
    tags={toTagsState(tagsQuery)}
    onSetTags={runSetTags}
    onCreateTag={createTag}
    onSetTransfer={runSetTransfer}
    transferDestinations={transferDestinations}
  />
}

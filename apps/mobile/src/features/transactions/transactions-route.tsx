import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { mapCategories } from '@/features/categories/categories-view-model'
import { useCategories } from '@/features/categories/use-categories'
import { effectiveMemberFilter, type AccountAttributionDto, type SpentByValue } from '@/features/household/member-attribution'
import { useHouseholdMembers } from '@/features/household/use-household-members'
import { useAiHiddenPreference } from '@/features/preferences/use-ai-hidden'
import { RuleApplyOffer } from '@/features/rules/rule-apply-offer'
import { RuleEditorSheet } from '@/features/rules/rule-editor-sheet'
import { RuleSuggestionPrompt } from '@/features/rules/rule-suggestion-prompt'
import type { RuleDto, RuleSuggestionDto } from '@/features/rules/rules-contract'
import { seedRuleFromSuggestion, seedRuleFromTransaction, type RuleEditorForm } from '@/features/rules/rules-view-model'
import { toTagsState, useCreateTagForPicker, useSetTransactionTags, useTags } from '@/features/tags/use-tags'
import { ApiError } from '@/lib/api/errors'
import { canWriteAccount, readOnlyAccountKeys } from '@/features/accounts/account-access'
import { parseAccountId } from '@/features/accounts/accounts-contract'
import { useAccounts } from '@/features/accounts/use-accounts'
import { SplitWithGroupScreen } from '@/features/expense-groups/split-with-group-screen'
import { useGroupAccess } from '@/features/expense-groups/use-group-access'
import { useTranslation } from 'react-i18next'

import { localCalendarDay, localDayRange } from '@/lib/dates/transaction-date'

import type { LinkedTransactionDto } from './reimbursements-contract'
import { classifyReimbursementFailure } from './reimbursements-view-model'
import { TransactionReimbursementScreen } from './transaction-reimbursement-screen'
import type { TransactionFilters, TransactionSplitLineRequest, TransferEditDraft } from './transactions-contract'
import { DEFAULT_RANGE_DAYS, presetRange } from './transactions-date-range'
import { type BulkDeleteOutcome, type BulkScope, type DeleteOneResult, TransactionsScreen, type ReviewResult, type TransactionsFreshness, type TransactionsViewState, type UnlinkReimbursementResult } from './transactions-screen'
import { mapTransactions } from './transactions-view-model'
import { useEditTransactionAmount } from './use-edit-transaction-amount'
import { useEditTransactionAttribution } from './use-edit-transaction-attribution'
import { useEditTransactionTransfer } from './use-edit-transaction-transfer'
import { skippedBankSyncedIds, useDeleteTransactions } from './use-delete-transactions'
import { useTransactionBulkActions, type TransactionBulkAction, type TransactionBulkSelection } from './use-mark-reviewed'
import { useUnlinkReimbursement } from './use-transaction-reimbursements'
import { useRemoveTransactionSplits, useSetTransactionSplits } from './use-transaction-splits'
import { useTransactions } from './use-transactions'
import { useTransactionsLead } from './use-transactions-lead'
import { useTransferDestinations } from './use-transfer-destinations'

function classifyResult(error: unknown, blockAccess: (state: 'mfa-required') => void): ReviewResult {
  if (!(error instanceof ApiError)) return 'error'
  if (error.code === 'demo-forbidden') return 'demo'
  if (error.code === 'household-read-only') return 'read-only'
  if (error.code === 'account-read-only') return 'account-read-only'
  if (error.code === 'cancelled') return 'cancelled'
  if (error.code === 'network') return 'network'
  if (error.code === 'mfa-required') { blockAccess('mfa-required'); return 'mfa' }
  // The transaction is shared in an expense group, whose shares are its split.
  if (error.code === 'http' && error.serverCode === 'transaction_in_expense_group') return 'in-group'
  return 'error'
}

/** The first value of a search param, which expo-router may hand back as an array. */
const firstParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)

type RouteParams = { accountId?: string | string[]; categoryKeys?: string | string[]; filter?: string | string[]; focus?: string | string[]; fromDate?: string | string[]; toDate?: string | string[] }

/** The row a followed link opens on (`?focus=<id>`), or null. */
function focusParam(params: RouteParams): number | null {
  const value = Number(firstParam(params.focus))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * Where the other side of a reimbursement link is shown: its account's ledger (all accounts when
 * the API did not say which), on its own day, opened on it.
 */
export function linkedTransactionHref(linked: LinkedTransactionDto): Href {
  const params: Record<string, string> = { focus: String(linked.transactionKey) }
  const day = linked.transactionDate ? localCalendarDay(linked.transactionDate) : null
  if (day) {
    try {
      Object.assign(params, localDayRange(day, day))
    } catch {
      // An unreadable date opens the ledger's usual range; the row may then not be in it.
    }
  }
  return linked.accountKey
    ? { pathname: '/accounts/[accountId]/transactions', params: { ...params, accountId: String(linked.accountKey) } } as Href
    : { pathname: '/accounts/transactions', params } as Href
}

/**
 * The list's opening filters. A home insight links here with its own date range and categories,
 * so the ledger opens on exactly the rows the card counted; otherwise the last 60 days.
 */
function initialFilters(params: RouteParams, reviewOnly: boolean): TransactionFilters {
  if (reviewOnly) return { limit: 100, needsReview: true }
  const fromDate = firstParam(params.fromDate)
  const toDate = firstParam(params.toDate)
  // A followed link opens on the linked row's day, in both directions, transfers included.
  if (focusParam(params) !== null) return fromDate && toDate ? { fromDate, toDate, limit: 100 } : presetRange(DEFAULT_RANGE_DAYS)
  const categoryIds = (firstParam(params.categoryKeys) ?? '')
    .split(',')
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  if (!fromDate && !toDate && categoryIds.length === 0) return presetRange(DEFAULT_RANGE_DAYS)
  return {
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    ...(categoryIds.length > 0 ? { categoryIds } : {}),
    direction: 'out',
    excludeNonSpending: true,
    excludeTransfers: true,
    limit: 100,
    statuses: ['BOOKED', 'PENDING'],
  }
}

export function TransactionsRoute({ perAccount = false }: { perAccount?: boolean }) {
  const params = useLocalSearchParams<RouteParams>()
  const accountId = perAccount ? parseAccountId(params.accountId) : null
  // Home's "Review now" opens the ledger already narrowed to the review inbox, with no date
  // range: an unreviewed row from last year must not be hidden by the list's 60-day default.
  const reviewOnly = !perAccount && firstParam(params.filter) === 'unreviewed'
  // Web opens both ledgers on the last 60 days (`subDays(new Date(), 60)`).
  const [filters, setFilters] = useState<TransactionFilters>(() => initialFilters(params, reviewOnly))
  const members = useHouseholdMembers()
  // The member filter applies to the all-accounts ledger only, and never names someone who left.
  const memberFilter = perAccount ? null : effectiveMemberFilter(filters.memberKeys?.[0] ?? null, members)
  const requestFilters = useMemo<TransactionFilters>(() => ({ ...filters, memberKeys: memberFilter === null ? undefined : [memberFilter] }), [filters, memberFilter])
  const query = useTransactions(requestFilters, perAccount ? accountId : null)
  const accountsQuery = useAccounts()
  const accountAttributions = useMemo(() => new Map<number, AccountAttributionDto>((accountsQuery.data?.accounts ?? []).flatMap((account) => (
    account.attribution ? [[account.accountKey, account.attribution] as const] : []
  ))), [accountsQuery.data])
  const lead = useTransactionsLead({ fromDate: filters.fromDate, toDate: filters.toDate }, !perAccount)
  const categoriesQuery = useCategories()
  const mutation = useTransactionBulkActions()
  const deletion = useDeleteTransactions()
  const amountMutation = useEditTransactionAmount()
  const transferMutation = useEditTransactionTransfer()
  const attributionMutation = useEditTransactionAttribution()
  const setSplits = useSetTransactionSplits()
  const removeSplits = useRemoveTransactionSplits()
  const unlinkReimbursement = useUnlinkReimbursement()
  const [reimburseId, setReimburseId] = useState<number | null>(null)
  const [groupShareId, setGroupShareId] = useState<number | null>(null)
  const groupAccess = useGroupAccess()
  const [focusTransactionId] = useState(() => focusParam(params))
  const transferDestinations = useTransferDestinations(accountsQuery.data?.accounts)
  const tagsQuery = useTags()
  const tagsMutation = useSetTransactionTags()
  const createTag = useCreateTagForPicker()
  const { blockAccess } = useProductRuntime()
  const aiHidden = useAiHiddenPreference()
  const { t, i18n } = useTranslation()
  const router = useRouter()
  // "Create rule" from a row: the pre-filled form, then the saved rule's apply offer.
  const [ruleSeed, setRuleSeed] = useState<RuleEditorForm | null>(null)
  const [savedRule, setSavedRule] = useState<RuleDto | null>(null)
  // A recategorization that repeats a pattern offers a rule; "Create rule" opens the editor seeded with it.
  const [ruleSuggestion, setRuleSuggestion] = useState<RuleSuggestionDto | null>(null)
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
  // Rows of an account the caller can only view (#95) offer no change; nor does a ledger whose
  // accounts all are, which has nowhere to add or import a transaction.
  const readOnlyAccountIds = readOnlyAccountKeys(accounts)
  const canAddTransactions = perAccount
    ? canWriteAccount(accounts.find((account) => account.accountKey === accountId))
    : accounts.length === 0 || accounts.some(canWriteAccount)

  const runAction = async (action: TransactionBulkAction): Promise<ReviewResult> => {
    try {
      const outcome = await mutation.mutateAsync(action)
      if (action.type === 'category' && outcome.ruleSuggestion) setRuleSuggestion(outcome.ruleSuggestion)
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  // "Every matching row" is the list's own server filters, and on one account's ledger that account.
  const selectionOf = (scope: BulkScope): TransactionBulkSelection => (scope === 'matching' ? { filter: requestFilters, accountId: perAccount ? accountId : null } : { transactionIds: scope })

  const runBulkDelete = async (scope: BulkScope): Promise<BulkDeleteOutcome> => {
    try {
      const outcome = await deletion.bulk.mutateAsync(selectionOf(scope))
      return { result: 'success', deletedCount: outcome.deletedTransactionIds.length, skippedIds: skippedBankSyncedIds(outcome) }
    } catch (error) {
      return { result: classifyResult(error, blockAccess) }
    }
  }

  const runDeleteOne = async (transactionId: number): Promise<DeleteOneResult> => {
    try {
      await deletion.single.mutateAsync(transactionId)
      return 'success'
    } catch (error) {
      // 409: the bank sent the row, so it can be hidden but not deleted.
      if (error instanceof ApiError && error.code === 'http' && error.status === 409) return 'bank-synced'
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

  const runSetSpentBy = async (transactionId: number, attributedAppuserKey: SpentByValue): Promise<ReviewResult> => {
    try {
      await attributionMutation.mutateAsync({ transactionId, attributedAppuserKey })
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  const runSaveSplit = async (transactionId: number, lines: readonly TransactionSplitLineRequest[]): Promise<ReviewResult> => {
    try {
      await setSplits.mutateAsync({ transactionId, lines })
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  const runRemoveSplit = async (transactionId: number): Promise<ReviewResult> => {
    try {
      await removeSplits.mutateAsync(transactionId)
      return 'success'
    } catch (error) {
      return classifyResult(error, blockAccess)
    }
  }

  const runUnlinkReimbursement = async (transactionId: number, transactionReimbursementKey: number): Promise<UnlinkReimbursementResult> => {
    try {
      await unlinkReimbursement.mutateAsync({ transactionId, transactionReimbursementKey })
      return 'success'
    } catch (error) {
      return classifyReimbursementFailure(error)
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

  // Read from the list each render, so the screen follows the row as its links change.
  const reimburseRow = reimburseId === null || !('transactions' in state) ? null : state.transactions.find((row) => row.id === reimburseId) ?? null
  const groupShareRow = groupShareId === null || !('transactions' in state) ? null : state.transactions.find((row) => row.id === groupShareId) ?? null

  const ruleCategories = categoryState.status === 'loaded'
    ? categoryState.categories.flatMap((category) => [category, ...category.children]).map((category) => ({ id: category.id, name: category.name }))
    : []

  return <>
  <TransactionsScreen
    state={state}
    filters={requestFilters}
    total={query.data?.total ?? null}
    hasMore={query.data?.hasMore}
    categories={categoryState}
    accountCount={accountsQuery.data?.accounts.length}
    pending={mutation.isPending || deletion.bulk.isPending || deletion.single.isPending || amountMutation.isPending || transferMutation.isPending || attributionMutation.isPending || setSplits.isPending || removeSplits.isPending || unlinkReimbursement.isPending}
    accountName={accountName}
    perAccount={perAccount}
    lead={perAccount ? undefined : lead}
    leadCurrency={leadCurrency}
    freshness={perAccount ? null : freshness}
    onBack={() => perAccount && accountId ? router.replace(`/accounts/${accountId}`) : router.replace('/accounts')}
    onCreate={!canAddTransactions ? undefined : () => router.push({ pathname: '/accounts/transactions/create', ...(accountId ? { params: { accountId: String(accountId) } } : {}) } as Href)}
    onImport={!canAddTransactions ? undefined : () => router.push({ pathname: '/accounts/transactions/import', ...(accountId ? { params: { accountId: String(accountId) } } : {}) } as Href)}
    onScanReceipt={aiHidden || !canAddTransactions ? undefined : () => router.push('/accounts/transactions/scan' as Href)}
    onFiltersChange={setFilters}
    onRefresh={async () => { await query.refetch() }}
    onMarkReviewed={(transactionId) => runAction({ type: 'review', transactionIds: [transactionId] })}
    onBulkReview={(scope) => runAction({ type: 'review', ...selectionOf(scope) })}
    onAssignCategory={(scope, categoryId) => runAction({ type: 'category', categoryId, ...selectionOf(scope) })}
    onSetHidden={(scope, hidden) => runAction({ type: hidden ? 'hidden' : 'unhidden', ...selectionOf(scope) })}
    onBulkTag={(scope, tagId, mode) => runAction({ type: mode === 'add' ? 'addTag' : 'removeTag', tagId, ...selectionOf(scope) })}
    onBulkDelete={runBulkDelete}
    onDeleteOne={runDeleteOne}
    onEditAmount={runAmountEdit}
    tags={toTagsState(tagsQuery)}
    onSetTags={runSetTags}
    onCreateTag={createTag}
    onSetTransfer={runSetTransfer}
    transferDestinations={transferDestinations}
    onOpenInstallmentPlan={(row) => {
      if (!row.installment) return
      router.push({ pathname: '/accounts/[accountId]/installments/[planId]', params: { accountId: String(row.accountId), planId: String(row.installment.installmentPlanKey) } })
    }}
    onCreateRule={(row) => setRuleSeed(seedRuleFromTransaction({ merchant: row.merchant, description: row.description, categoryId: row.categoryId }))}
    onSaveSplit={runSaveSplit}
    onRemoveSplit={runRemoveSplit}
    onMarkReimbursement={(row) => setReimburseId(row.id)}
    onSplitWithGroup={groupAccess.canWrite ? (row) => setGroupShareId(row.id) : undefined}
    onUnlinkReimbursement={runUnlinkReimbursement}
    onOpenTransaction={(linked) => router.push(linkedTransactionHref(linked))}
    focusTransactionId={focusTransactionId}
    readOnlyAccountIds={readOnlyAccountIds}
    members={members}
    accountAttributions={accountAttributions}
    onSetSpentBy={members.multiMember && !members.readOnly ? runSetSpentBy : undefined}
  />
  {reimburseRow ? (
    <TransactionReimbursementScreen
      locale={i18n.resolvedLanguage ?? i18n.language ?? 'en'}
      onClose={() => setReimburseId(null)}
      transaction={reimburseRow}
    />
  ) : null}
  {groupShareRow ? (
    <SplitWithGroupScreen
      canWrite={groupAccess.canWrite}
      locale={i18n.resolvedLanguage ?? i18n.language ?? 'en'}
      onClose={() => setGroupShareId(null)}
      transaction={groupShareRow}
    />
  ) : null}
  <RuleEditorSheet
    categories={ruleCategories}
    onClose={() => setRuleSeed(null)}
    onSaved={(rule) => { setRuleSeed(null); setSavedRule(rule) }}
    rule={null}
    seed={ruleSeed}
    visible={ruleSeed !== null}
  />
  {savedRule ? <RuleApplyOffer key={savedRule.ruleKey} onApplied={() => { void query.refetch() }} onClose={() => setSavedRule(null)} rule={savedRule} /> : null}
  {ruleSuggestion && ruleSeed === null ? (
    <RuleSuggestionPrompt
      key={ruleSuggestion.fingerprint}
      categoryName={ruleCategories.find((category) => category.id === ruleSuggestion.category.categoryKey)?.name}
      onClose={() => setRuleSuggestion(null)}
      onCreate={(suggestion) => { setRuleSuggestion(null); setRuleSeed(seedRuleFromSuggestion(suggestion)) }}
      suggestion={ruleSuggestion}
    />
  ) : null}
  </>
}

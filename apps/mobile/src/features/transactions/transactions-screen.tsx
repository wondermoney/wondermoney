import type { TFunction } from 'i18next'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native'
import type { ListRenderItemInfo } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { Button as UiButton } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { EntityMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { describeFxState, FxStatusLabel } from '@/components/ui/fx-status-label'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { ListGroupHeading, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Divider } from '@/components/ui/section'
import { OptionSheet, Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import type { CategoryViewModel } from '@/features/categories/categories-view-model'
import { displayCategoryName } from '@/features/categories/categories-view-model'
import { TagChips, TagDot } from '@/features/tags/tag-chip'
import { TagPickerSheet, type CreateTagOutcome, type TagsState } from '@/features/tags/tag-picker-sheet'
import { formatTransactionDate, localCalendarDay, localDayRange } from '@/lib/dates/transaction-date'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { amountExpressionResult, formatNumberInput, parseAmountInput } from '@/lib/formatters/decimal-input'
import { formatMoneyForDisplay, PRIVACY_MASK } from '@/lib/formatters/money-display'
import { formatRelativeTime } from '@/lib/formatters/relative-time'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FormNotice, TextField } from './form-field'
import { SelectField } from './select-field'
import { TransactionAttachmentsSection } from './transaction-attachments-section'
import { TransactionSplitScreen } from './transaction-split-screen'
import { BULK_TRANSACTION_LIMIT, type TransactionFilters, type TransactionSplitLineRequest, type TransferDestinationType, type TransferEditDraft } from './transactions-contract'
import { formatMonth, formatRange, formatShortDate, monthKey, presetFor, presetRange, RANGE_PRESETS, type RangePreset } from './transactions-date-range'
import { TransactionsLead } from './transactions-lead'
import { canSplitTransaction, splitCategoryCount } from './transactions-split-view-model'
import type { TransactionViewModel } from './transactions-view-model'
import type { TransactionsLeadData } from './use-transactions-lead'

export type ReviewResult = 'success' | 'demo' | 'mfa' | 'cancelled' | 'network' | 'error'
export type TransactionCategoryState =
  | { status: 'loading' | 'error' }
  | { status: 'loaded'; categories: readonly CategoryViewModel[] }
/**
 * What a bulk action covers: the selected loaded rows, or `'matching'` — every row the list's
 * server filters match, which the route sends as the list's filter ("select all matching").
 */
export type BulkScope = readonly number[] | 'matching'
/** What a bulk delete came to: how many rows went, and the bank rows it skipped (to offer hiding them). */
export type BulkDeleteOutcome = Readonly<{ result: ReviewResult; deletedCount?: number; skippedIds?: readonly number[] }>
/** A single delete; `bank-synced` when the bank sent the row, which is never deleted. */
export type DeleteOneResult = ReviewResult | 'bank-synced'
type FrozenBulkAction =
  | Readonly<{ type: 'review'; transactionIds: BulkScope; count: number }>
  | Readonly<{ type: 'category'; transactionIds: BulkScope; count: number; category: CategoryViewModel }>
  | Readonly<{ type: 'hidden'; transactionIds: BulkScope; count: number; hidden: boolean }>
  | Readonly<{ type: 'delete'; transactionIds: BulkScope; count: number; synced: readonly number[] | null }>
  | Readonly<{ type: 'tag'; transactionIds: BulkScope; count: number }>
const LARGE_BULK_THRESHOLD = 10
export type TransactionsViewState =
  | { status: 'loading' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-account' | 'access-transition' }
  | { status: 'loaded' | 'refresh-error'; transactions: readonly TransactionViewModel[]; refreshing: boolean }

/** What an outgoing transfer can be marked as going to. Each list is the household's own. */
export type TransferDestinationOptions = Readonly<{
  accounts: readonly Readonly<{ key: number; name: string }>[]
  portfolios: readonly Readonly<{ key: number; name: string }>[]
  goals: readonly Readonly<{ key: number; name: string }>[]
}>

/** How fresh the balances behind the list are (web `AccountsFreshness`). */
export type TransactionsFreshness = Readonly<{ kind: 'updated'; at: string } | { kind: 'stale' }> | null

type Props = Readonly<{
  state: TransactionsViewState
  filters: TransactionFilters
  /** Every row matching the server filters, as the API counts it; `null` when it did not say. */
  total?: number | null
  /** Whether the server has rows beyond the loaded page. */
  hasMore?: boolean
  accountCount?: number
  accountName?: string | null
  /** One account's ledger (`/accounts/[id]/transactions`): a back link, the account under the title, no lead figures. */
  perAccount?: boolean
  /** The figures above the all-accounts ledger. Omitted, the lead is not drawn. */
  lead?: TransactionsLeadData
  /** The reporting currency money in and out are summed in. */
  leadCurrency?: string | null
  freshness?: TransactionsFreshness
  onBack: () => void
  onCreate?: () => void
  onImport?: () => void
  onScanReceipt?: () => void
  onFiltersChange: (filters: TransactionFilters) => void
  onRefresh: () => void | Promise<void>
  onMarkReviewed: (transactionId: number) => Promise<ReviewResult>
  categories?: TransactionCategoryState
  pending?: boolean
  onBulkReview?: (transactionIds: BulkScope) => Promise<ReviewResult>
  onAssignCategory?: (transactionIds: BulkScope, categoryId: number) => Promise<ReviewResult>
  onSetHidden?: (transactionIds: BulkScope, hidden: boolean) => Promise<ReviewResult>
  /** Add or remove one household tag on the selection. Omitted, "Tag" is not offered. */
  onBulkTag?: (transactionIds: BulkScope, tagId: number, mode: 'add' | 'remove') => Promise<ReviewResult>
  /** Delete the selection (bank rows are skipped). Omitted, "Delete" is not offered. */
  onBulkDelete?: (transactionIds: BulkScope) => Promise<BulkDeleteOutcome>
  /** Delete one row from its menu. Omitted, the action is not offered. */
  onDeleteOne?: (transactionId: number) => Promise<DeleteOneResult>
  onEditAmount?: (transactionId: number, updatedAmount: string, description?: string) => Promise<ReviewResult>
  /** The household's tags, for the filter and the picker. Omitted or failed, both stay hidden. */
  tags?: TagsState
  /** Replace a transaction's tags. Omitted, rows show their tags read-only. */
  onSetTags?: (transactionId: number, tagIds: readonly number[]) => Promise<ReviewResult>
  onCreateTag?: (name: string) => Promise<CreateTagOutcome>
  /** Mark a row as a transfer (or not). Omitted, the actions are not offered. */
  onSetTransfer?: (draft: TransferEditDraft) => Promise<ReviewResult>
  transferDestinations?: TransferDestinationOptions
  /** Pre-fill a new rule from a row ("always do this"). Omitted, the action is not offered. */
  onCreateRule?: (transaction: TransactionViewModel) => void
  /** Replace a transaction's split lines. Omitted, the Split action is not offered. */
  onSaveSplit?: (transactionId: number, lines: readonly TransactionSplitLineRequest[]) => Promise<ReviewResult>
  /** Remove a transaction's split. Omitted, the editor hides Remove split. */
  onRemoveSplit?: (transactionId: number) => Promise<ReviewResult>
}>

export function TransactionsScreen(props: Props) {
  const { filters } = props
  const serverScope = `${filters.fromDate ?? ''}|${filters.toDate ?? ''}|${filters.needsReview ?? false}|${filters.includeHidden ?? false}|${(filters.tagIds ?? []).join(',')}|${filters.limit ?? 100}`
  // Held above the keyed content so changing a server filter from inside the
  // sheet (which remounts the content) does not snap the sheet shut.
  const [filtersOpen, setFiltersOpen] = useState(false)
  return <TransactionsContent key={serverScope} {...props} filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen} />
}

type EditingBundle = Readonly<{
  transactionId: number
  amountDraft: string
  /** The draft is not a number (blank only keeps Save disabled). */
  amountInvalid: boolean
  amountReadable: boolean
  descriptionDraft: string
  amountSubmitting: boolean
  onAmountChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCancel: () => void
  onSave: (transactionId: number) => void
}>

function TransactionsContent({
  state,
  filters,
  total = null,
  hasMore,
  accountCount,
  accountName,
  perAccount = false,
  lead,
  leadCurrency = null,
  freshness = null,
  onBack,
  onCreate,
  onImport,
  onScanReceipt,
  onFiltersChange,
  onRefresh,
  onMarkReviewed,
  categories = { status: 'loading' },
  pending = false,
  onBulkReview,
  onAssignCategory,
  onSetHidden,
  onBulkTag,
  onBulkDelete,
  onDeleteOne,
  onEditAmount,
  tags = { status: 'loading' },
  onSetTags,
  onCreateTag,
  onSetTransfer,
  transferDestinations = { accounts: [], portfolios: [], goals: [] },
  onCreateRule,
  onSaveSplit,
  onRemoveSplit,
  filtersOpen,
  onFiltersOpenChange: setFiltersOpen,
}: Props & Readonly<{ filtersOpen: boolean; onFiltersOpenChange: (open: boolean) => void }>) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [editingAmountId, setEditingAmountId] = useState<number | null>(null)
  const [amountDraft, setAmountDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [amountSubmitting, setAmountSubmitting] = useState(false)
  const [accountFilter, setAccountFilter] = useState<number | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [merchantFilter, setMerchantFilter] = useState('')
  const period = presetFor(filters)
  /** How many filters in the sheet are doing something. The date range has its own control. */
  const tagFilter = filters.tagIds ?? []
  const advancedFilterCount = [filters.needsReview === true, filters.includeHidden === true, tagFilter.length > 0, accountFilter !== null, categoryFilter !== null, typeFilter !== null, merchantFilter.trim() !== ''].filter(Boolean).length
  const [rangeOpen, setRangeOpen] = useState(false)
  // A custom range is whole local days, so it reopens on the local days its bounds fall on.
  const [customFromDraft, setCustomFromDraft] = useState<string | null>(period === 'custom' && filters.fromDate && filters.toDate ? localCalendarDay(filters.fromDate) : null)
  const [customToDraft, setCustomToDraft] = useState<string | null>(period === 'custom' && filters.fromDate && filters.toDate ? localCalendarDay(filters.toDate) : null)
  const [customRangeError, setCustomRangeError] = useState<string | null>(null)
  // Row checkboxes only appear once someone asks to select: a box on every row
  // was a second control per transaction that most visits never use.
  const [selecting, setSelecting] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [rowMenuId, setRowMenuId] = useState<number | null>(null)
  const [visibleCount, setVisibleCount] = useState(50)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tagEditId, setTagEditId] = useState<number | null>(null)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagNotice, setTagNotice] = useState<string | null>(null)
  const [destinationId, setDestinationId] = useState<number | null>(null)
  const [transferPending, setTransferPending] = useState(false)
  const [splitId, setSplitId] = useState<number | null>(null)
  const [splitSaving, setSplitSaving] = useState(false)
  const [splitError, setSplitError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<FrozenBulkAction | null>(null)
  const [submittedAction, setSubmittedAction] = useState<FrozenBulkAction | null>(null)
  // The selection is every row the server filters match, not only the loaded ones.
  const [allMatching, setAllMatching] = useState(false)
  const [bulkTagOpen, setBulkTagOpen] = useState(false)
  // What the last bulk delete did, with the bank rows it skipped (offered for hiding).
  const [deleteNotice, setDeleteNotice] = useState<Readonly<{ deleted: number; skippedIds: readonly number[] }> | null>(null)
  const [deleteRowId, setDeleteRowId] = useState<number | null>(null)
  const [deleteRowPending, setDeleteRowPending] = useState(false)
  const [deleteRowError, setDeleteRowError] = useState<string | null>(null)
  const loaded = useMemo(() => 'transactions' in state ? state.transactions : [], [state])
  const accountOptions = useMemo(() => [...new Map(loaded.map((row) => [row.accountId, row.accountName])).entries()], [loaded])
  const categoryOptions = useMemo(() => [...new Set(loaded.map((row) => row.category).filter((value): value is string => Boolean(value)))], [loaded])
  const typeOptions = useMemo(() => [...new Set(loaded.map((row) => row.type).filter((value): value is string => Boolean(value)))], [loaded])
  const categoryChoices = useMemo(() => categories.status === 'loaded'
    ? categories.categories.flatMap((category) => [category, ...category.children])
    : [], [categories])

  // Stable per-row callbacks: kept referentially identical across renders so
  // TransactionRow (React.memo) only re-renders the rows whose own props changed.
  const toggleExpand = useCallback((id: number) => {
    setExpandedId((current) => (current === id ? null : id))
  }, [])
  const toggleSelect = useCallback((id: number) => {
    setAllMatching(false)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const markReviewed = useCallback((id: number) => {
    void (async () => {
      setReviewingId(id)
      setReviewResult(null)
      const result = await onMarkReviewed(id)
      setReviewResult(result)
      setReviewingId(null)
    })()
  }, [onMarkReviewed])
  const startEditAmount = useCallback((item: TransactionViewModel) => {
    setExpandedId(item.id)
    setEditingAmountId(item.id)
    setAmountDraft(item.settlementAmount !== null ? formatNumberInput(item.settlementAmount, locale) : '')
    setDescriptionDraft(item.description ?? '')
  }, [locale])
  const cancelEditAmount = useCallback(() => {
    setEditingAmountId(null)
    setAmountDraft('')
    setDescriptionDraft('')
  }, [])
  // Read in the app's language ("-1.234,56" in pt and es) and sent as a dot decimal.
  const amountWire = parseAmountInput(amountDraft, locale)
  const saveEditAmount = useCallback((id: number) => {
    if (!onEditAmount || amountWire === null) return
    void (async () => {
      setAmountSubmitting(true)
      setReviewResult(null)
      const result = await onEditAmount(id, amountWire, descriptionDraft)
      setReviewResult(result)
      setAmountSubmitting(false)
      if (result === 'success') {
        setEditingAmountId(null)
        setAmountDraft('')
        setDescriptionDraft('')
      }
    })()
  }, [onEditAmount, amountWire, descriptionDraft])
  const openRowMenu = useCallback((id: number) => setRowMenuId(id), [])
  const openTagEditor = useCallback((id: number) => { setTagNotice(null); setTagEditId(id) }, [])

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading palette={palette} label={t('transactions.loading')} onBack={onBack} perAccount={perAccount} accountName={accountName} />
  if (!('transactions' in state)) {
    const key = state.status === 'invalid-response' ? 'invalid'
      : state.status === 'not-found' ? 'notFound'
        : state.status === 'invalid-account' ? 'invalidAccount' : 'error'
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <View style={styles.failure}>
          {perAccount || state.status === 'not-found' || state.status === 'invalid-account' ? <BackControl fallback="/accounts" onPress={onBack} /> : null}
          <Text accessibilityRole="header" variant="section">{t(`transactions.${key}.title`)}</Text>
          <Text tone="muted" variant="meta">{t(`transactions.${key}.message`)}</Text>
          {state.status === 'error' || state.status === 'invalid-response'
            ? <UiButton label={t('common.retry')} onPress={onRefresh} variant="outline" /> : null}
        </View>
      </SafeAreaView>
    )
  }

  const bulkAvailable = Boolean(onBulkReview || onAssignCategory || onSetHidden || onBulkTag || onBulkDelete) && loaded.some(isSelectable)
  const resultMessage = reviewResult && reviewResult !== 'success'
    ? t(`transactions.reviewResult.${reviewResult}`) : null
  const filtered = loaded.filter((row) => (accountFilter === null || row.accountId === accountFilter)
    && (categoryFilter === null || row.category === categoryFilter)
    && (typeFilter === null || row.type === typeFilter)
    && (!merchantFilter.trim() || row.merchant?.toLocaleLowerCase(locale).includes(merchantFilter.trim().toLocaleLowerCase(locale))))
  const visible = filtered.slice(0, visibleCount)
  const requestLimit = filters.limit ?? 100
  // Synthetic opening-balance rows ride along with the first page, so 100
  // requested rows can arrive as 101. Count only persisted rows against the
  // limit when the server did not say whether more exist.
  const serverHasMore = hasMore ?? loaded.filter((row) => !row.synthetic).length >= requestLimit
  // Counted as web counts: the server's `total` and the rows on the page, the
  // synthetic "Initial balance" rows included (web lists them as rows too).
  const countLine = total !== null && total > loaded.length
    ? t('transactions.resultShowing', { shown: loaded.length, total })
    : t('transactions.resultCount', { count: loaded.length })
  const loadedIds = new Set(loaded.filter(isSelectable).map((row) => row.id))
  const selected = [...selectedIds].filter((id) => loadedIds.has(id)).sort((left, right) => left - right)
  const selectedRows = loaded.filter((row) => selectedIds.has(row.id))
  // "Select all N matching" acts on the server's filters, so it is offered only while every
  // filter in force is one the server applies: a filter over the loaded rows (account, category,
  // type, merchant) would not be in the request, and the action would reach rows it hides.
  const localFiltersActive = accountFilter !== null || categoryFilter !== null || typeFilter !== null || merchantFilter.trim() !== ''
  const everyLoadedSelected = loadedIds.size > 0 && [...loadedIds].every((id) => selectedIds.has(id))
  const matchingAvailable = !localFiltersActive && everyLoadedSelected && total !== null && total > loadedIds.size
  const matchingSelected = allMatching && matchingAvailable
  const scope: BulkScope = matchingSelected ? 'matching' : selected
  const scopeCount = matchingSelected && total !== null ? total : selected.length
  const allSelectedVisible = matchingSelected || (selectedRows.length > 0 && selectedRows.every((row) => !row.hidden))
  const allSelectedHidden = matchingSelected ? filters.includeHidden === true : selectedRows.length > 0 && selectedRows.every((row) => row.hidden)
  const selectedSynced = selectedRows.filter((row) => row.bankSynced).map((row) => row.id)
  const mutationPending = pending || submittedAction !== null || transferPending
  const scopeLocked = mutationPending || confirmation !== null
  const completeAction = async (submitted: FrozenBulkAction, action: () => Promise<ReviewResult>) => {
    setReviewResult(null)
    setSubmittedAction(submitted)
    try {
      const result = await action()
      setReviewResult(result)
      if (result === 'success') {
        setSelectedIds(new Set())
        setAllMatching(false)
        setPickerOpen(false)
        setBulkTagOpen(false)
        setConfirmation(null)
      }
    } finally {
      setSubmittedAction(null)
    }
  }
  const frozenScope = (): BulkScope => (scope === 'matching' ? 'matching' : [...scope])
  const reviewSelected = async () => {
    if (!onBulkReview) return
    const frozen: FrozenBulkAction = { type: 'review', transactionIds: frozenScope(), count: scopeCount }
    if (frozen.count >= LARGE_BULK_THRESHOLD) {
      setConfirmation(frozen)
      return
    }
    await completeAction(frozen, () => onBulkReview(frozen.transactionIds))
  }
  const assignCategory = async (category: CategoryViewModel) => {
    if (!onAssignCategory) return
    const frozen: FrozenBulkAction = { type: 'category', transactionIds: frozenScope(), count: scopeCount, category }
    if (frozen.count >= LARGE_BULK_THRESHOLD) {
      setConfirmation(frozen)
      return
    }
    await completeAction(frozen, () => onAssignCategory(frozen.transactionIds, category.id))
  }
  const setHiddenSelected = async (hidden: boolean) => {
    if (!onSetHidden) return
    const frozen: FrozenBulkAction = { type: 'hidden', transactionIds: frozenScope(), count: scopeCount, hidden }
    if (frozen.count >= LARGE_BULK_THRESHOLD) {
      setConfirmation(frozen)
      return
    }
    await completeAction(frozen, () => onSetHidden(frozen.transactionIds, hidden))
  }
  const tagSelected = async (value: string) => {
    setBulkTagOpen(false)
    if (!onBulkTag) return
    const [mode, key] = value.split(':')
    const tagId = Number(key)
    const frozen: FrozenBulkAction = { type: 'tag', transactionIds: frozenScope(), count: scopeCount }
    await completeAction(frozen, () => onBulkTag(frozen.transactionIds, tagId, mode === 'remove' ? 'remove' : 'add'))
  }
  // A delete always asks first, with the count and the bank rows it will skip.
  const deleteSelected = () => {
    if (!onBulkDelete) return
    setConfirmation({ type: 'delete', transactionIds: frozenScope(), count: scopeCount, synced: matchingSelected ? null : [...selectedSynced] })
  }
  const hideIds = async (ids: readonly number[]) => {
    if (!onSetHidden || ids.length === 0) return
    const frozen: FrozenBulkAction = { type: 'hidden', transactionIds: [...ids], count: ids.length, hidden: true }
    await completeAction(frozen, () => onSetHidden(frozen.transactionIds, true))
    setDeleteNotice(null)
  }
  const runDelete = async (frozen: Extract<FrozenBulkAction, { type: 'delete' }>) => {
    if (!onBulkDelete) return
    setDeleteNotice(null)
    await completeAction(frozen, async () => {
      const outcome = await onBulkDelete(frozen.transactionIds)
      if (outcome.result === 'success') setDeleteNotice({ deleted: outcome.deletedCount ?? 0, skippedIds: outcome.skippedIds ?? [] })
      return outcome.result
    })
  }
  const confirmBulkAction = async () => {
    if (!confirmation) return
    if (confirmation.type === 'delete') {
      await runDelete(confirmation)
      return
    }
    if (confirmation.type === 'tag') return
    if (confirmation.type === 'review') {
      if (onBulkReview) await completeAction(confirmation, () => onBulkReview(confirmation.transactionIds))
      return
    }
    if (confirmation.type === 'hidden') {
      if (onSetHidden) await completeAction(confirmation, () => onSetHidden(confirmation.transactionIds, confirmation.hidden))
      return
    }
    if (onAssignCategory) await completeAction(confirmation, () => onAssignCategory(confirmation.transactionIds, confirmation.category.id))
  }
  const rest: TransactionFilters = { needsReview: filters.needsReview, includeHidden: filters.includeHidden, tagIds: filters.tagIds, limit: filters.limit }
  const choosePeriod = (next: RangePreset | 'all') => {
    setRangeOpen(false)
    if (scopeLocked || next === period) return
    if (next === 'all') { onFiltersChange(rest); return }
    onFiltersChange({ ...rest, ...presetRange(next) })
  }
  const applyCustomRange = () => {
    try {
      const range = localDayRange(customFromDraft ?? '', customToDraft ?? '')
      setCustomRangeError(null)
      setRangeOpen(false)
      onFiltersChange({ ...filters, fromDate: range.fromDate, toDate: range.toDate })
    } catch (error) {
      setCustomRangeError(error instanceof Error ? error.message : t('transactions.customRangeInvalid'))
    }
  }
  const clearAllFilters = () => {
    setAccountFilter(null)
    setCategoryFilter(null)
    setTypeFilter(null)
    setMerchantFilter('')
    setVisibleCount(50)
    if (filters.needsReview || filters.includeHidden || tagFilter.length > 0) onFiltersChange({ fromDate: filters.fromDate, toDate: filters.toDate, limit: filters.limit })
  }
  const toggleTagFilter = (tagKey: number) => {
    onFiltersChange({ ...filters, tagIds: tagFilter.includes(tagKey) ? tagFilter.filter((key) => key !== tagKey) : [...tagFilter, tagKey] })
  }
  const tagEditRow = tagEditId === null ? null : loaded.find((row) => row.id === tagEditId) ?? null
  const saveTags = async (tagIds: readonly number[]) => {
    if (!onSetTags || tagEditRow === null) return
    setTagSaving(true)
    setTagNotice(null)
    try {
      const result = await onSetTags(tagEditRow.id, tagIds)
      if (result === 'success') setTagEditId(null)
      else setTagNotice(t(`transactions.reviewResult.${result}`))
    } finally {
      setTagSaving(false)
    }
  }

  const runTransferEdit = async (draft: TransferEditDraft) => {
    if (!onSetTransfer) return
    setTransferPending(true)
    setReviewResult(null)
    try {
      const result = await onSetTransfer(draft)
      setReviewResult(result)
      if (result === 'success') setDestinationId(null)
    } finally {
      setTransferPending(false)
    }
  }
  const destinationRow = destinationId === null ? null : loaded.find((row) => row.id === destinationId) ?? null
  const destinationValue = (type: TransferDestinationType, key: number) => `${type}:${key}`
  const destinationGroups = destinationRow ? [
    { options: [{ value: 'none', label: t('transactions.transfer.noDestination') }] },
    ...([
      ['account', transferDestinations.accounts.filter((account) => account.key !== destinationRow.accountId)],
      ['portfolio', transferDestinations.portfolios],
      ['goal', transferDestinations.goals],
    ] as const).filter(([, options]) => options.length > 0).map(([type, options]) => ({
      label: t(`transactions.transfer.destinationGroups.${type}`),
      options: options.map((option) => ({ value: destinationValue(type, option.key), label: option.name })),
    })),
  ] : []
  const chooseDestination = (value: string) => {
    if (!destinationRow) return
    const [type, key] = value.split(':')
    const destination = value === 'none' ? null : { type: type as TransferDestinationType, key: Number(key) }
    void runTransferEdit({ transactionId: destinationRow.id, direction: 'debit', transfer: true, destination })
  }

  const splitRow = splitId === null ? null : loaded.find((row) => row.id === splitId) ?? null
  const openSplit = (id: number) => { setSplitError(null); setSplitId(id) }
  const saveSplit = async (lines: readonly TransactionSplitLineRequest[]) => {
    if (!onSaveSplit || splitId === null) return
    setSplitSaving(true)
    setSplitError(null)
    try {
      const result = await onSaveSplit(splitId, lines)
      if (result === 'success') setSplitId(null)
      else setSplitError(t(`transactions.reviewResult.${result}`))
    } finally {
      setSplitSaving(false)
    }
  }
  const removeSplit = async () => {
    if (!onRemoveSplit || splitId === null) return
    setSplitSaving(true)
    setSplitError(null)
    try {
      const result = await onRemoveSplit(splitId)
      if (result === 'success') setSplitId(null)
      else setSplitError(t(`transactions.reviewResult.${result}`))
    } finally {
      setSplitSaving(false)
    }
  }

  const editingBundle: EditingBundle | null = editingAmountId === null ? null : {
    transactionId: editingAmountId,
    amountDraft,
    amountInvalid: amountDraft.trim() !== '' && amountWire === null,
    amountReadable: amountWire !== null,
    descriptionDraft,
    amountSubmitting,
    onAmountChange: setAmountDraft,
    onDescriptionChange: setDescriptionDraft,
    onCancel: cancelEditAmount,
    onSave: saveEditAmount,
  }

  const canEditAmount = Boolean(onEditAmount)
  const canEditTags = Boolean(onSetTags && onCreateTag) && tags.status === 'loaded'
  const renderRow = ({ item, index }: ListRenderItemInfo<TransactionViewModel>) => (
    <TransactionRow
      item={item}
      isFirst={index === 0}
      monthStart={index === 0 || monthKey(visible[index - 1].date) !== monthKey(item.date)}
      expanded={expandedId === item.id}
      selecting={selecting}
      selected={selectedIds.has(item.id)}
      scopeLocked={scopeLocked}
      mutationPending={mutationPending}
      reviewing={reviewingId === item.id}
      editing={editingBundle && editingBundle.transactionId === item.id ? editingBundle : null}
      canEditAmount={canEditAmount}
      canEditTags={canEditTags}
      onEditTags={openTagEditor}
      onToggleExpand={toggleExpand}
      onToggleSelect={toggleSelect}
      onMarkReviewed={markReviewed}
      onStartEditAmount={startEditAmount}
      onOpenMenu={openRowMenu}
      onCreateRule={onCreateRule}
      onSplit={openSplit}
      canSplit={Boolean(onSaveSplit) && categories.status === 'loaded'}
      palette={palette}
      locale={locale}
    />
  )

  const clearSelection = () => { setSelectedIds(new Set()); setAllMatching(false); setPickerOpen(false); setBulkTagOpen(false); setConfirmation(null) }
  const selectAllLoaded = () => { setSelectedIds(new Set(loadedIds)); setAllMatching(false) }
  const bulkTagGroups = tags.status === 'loaded' ? [
    { label: t('transactions.bulk.addTag'), options: tags.tags.map((tag) => ({ value: `add:${tag.tagKey}`, label: tag.name })) },
    { label: t('transactions.bulk.removeTag'), options: tags.tags.filter((tag) => matchingSelected || selectedRows.some((row) => row.tags.some((carried) => carried.tagKey === tag.tagKey))).map((tag) => ({ value: `remove:${tag.tagKey}`, label: tag.name })) },
  ].filter((group) => group.options.length > 0) : []
  const deleteRow = deleteRowId === null ? null : loaded.find((row) => row.id === deleteRowId) ?? null
  const openDeleteRow = (id: number) => { setDeleteRowError(null); setDeleteRowId(id) }
  const confirmDeleteRow = async () => {
    if (!onDeleteOne || deleteRow === null) return
    setDeleteRowPending(true)
    setDeleteRowError(null)
    try {
      const result = await onDeleteOne(deleteRow.id)
      if (result === 'success') setDeleteRowId(null)
      else setDeleteRowError(result === 'bank-synced' ? t('transactions.bulk.deleteOnlySynced', { count: 1 }) : t(`transactions.reviewResult.${result}`))
    } finally {
      setDeleteRowPending(false)
    }
  }
  const hideDeleteRow = async () => {
    if (!onSetHidden || deleteRow === null) return
    setDeleteRowPending(true)
    try {
      const result = await onSetHidden([deleteRow.id], true)
      if (result === 'success') setDeleteRowId(null)
      else setDeleteRowError(t(`transactions.reviewResult.${result}`))
    } finally {
      setDeleteRowPending(false)
    }
  }
  const secondaryActions = [
    ...(onImport ? [{ value: 'import' as const, label: t('transactionImport.action') }] : []),
    ...(onScanReceipt ? [{ value: 'scan' as const, label: t('transactionOcr.action') }] : []),
  ]
  const runSecondary = (value: 'import' | 'scan') => { if (value === 'import') onImport?.(); else onScanReceipt?.() }
  const showCreate = Boolean(onCreate) && !selecting
  const allAccountsValue = 0
  const allValue = ''

  const menuRow = rowMenuId === null ? null : loaded.find((row) => row.id === rowMenuId) ?? null
  const menuEditable = menuRow ? isSelectable(menuRow) : false
  type RowAction = 'details' | 'review' | 'edit' | 'tags' | 'transfer' | 'notTransfer' | 'destination' | 'select' | 'delete'
  const canRetype = Boolean(onSetTransfer) && menuRow !== null && menuEditable && menuRow.direction !== 'unknown' && !mutationPending
  const rowActions: { value: RowAction; label: string }[] = menuRow ? [
    { value: 'details', label: expandedId === menuRow.id ? t('transactions.hideDetails') : t('transactions.showDetails') },
    ...(menuEditable && !menuRow.reviewed && !mutationPending ? [{ value: 'review' as const, label: t('transactions.markReviewed') }] : []),
    ...(menuEditable && canEditAmount && !mutationPending ? [{ value: 'edit' as const, label: t('transactions.editAmount') }] : []),
    ...(menuEditable && canEditTags && !mutationPending ? [{ value: 'tags' as const, label: t('tags.edit') }] : []),
    ...(canRetype && !menuRow.isTransfer ? [{ value: 'transfer' as const, label: t('transactions.transfer.mark') }] : []),
    ...(canRetype && menuRow.isTransfer && menuRow.direction === 'debit' ? [{ value: 'destination' as const, label: t('transactions.transfer.chooseDestination') }] : []),
    ...(canRetype && menuRow.isTransfer ? [{ value: 'notTransfer' as const, label: t('transactions.transfer.unmark') }] : []),
    ...(menuEditable && bulkAvailable && !scopeLocked ? [{ value: 'select' as const, label: t('transactions.select') }] : []),
    ...(menuEditable && onDeleteOne && !mutationPending ? [{ value: 'delete' as const, label: t('transactions.bulk.deleteOne') }] : []),
  ] : []
  const runRowAction = (action: RowAction) => {
    if (!menuRow) return
    if (action === 'details') toggleExpand(menuRow.id)
    else if (action === 'review') markReviewed(menuRow.id)
    else if (action === 'edit') startEditAmount(menuRow)
    else if (action === 'tags') openTagEditor(menuRow.id)
    // Money going out is asked where it went (or nowhere in particular) in the same step.
    else if (action === 'transfer' && menuRow.direction === 'debit') setDestinationId(menuRow.id)
    else if (action === 'transfer') void runTransferEdit({ transactionId: menuRow.id, direction: 'credit', transfer: true })
    else if (action === 'destination') setDestinationId(menuRow.id)
    else if (action === 'notTransfer' && menuRow.direction !== 'unknown') void runTransferEdit({ transactionId: menuRow.id, direction: menuRow.direction, transfer: false })
    else if (action === 'delete') openDeleteRow(menuRow.id)
    else { setSelecting(true); setAllMatching(false); setSelectedIds((current) => new Set(current).add(menuRow.id)) }
  }

  const freshnessLine = freshness === null ? undefined
    : freshness.kind === 'stale' ? t('transactions.balancesStale')
      : t('transactions.balancesUpdated', { time: formatRelativeTime(freshness.at, t) ?? '' })
  const rangeLabel = formatRange(filters, locale) ?? t('transactions.allDates')
  const filtersLabel = t('transactions.moreFilters', { count: advancedFilterCount })

  const header = (
    <View style={styles.headerGroup}>
      <View style={styles.titleBlock}>
        {perAccount ? <BackControl destination={accountName ?? undefined} disabled={mutationPending} fallback="/accounts" onPress={onBack} /> : null}
        {/* Title row: the title, its help glyph and one overflow menu (import or scan).
            Adding a transaction is the floating button, always in the same place. */}
        <PageHeader
          action={secondaryActions.length > 0 ? (
            <IconButton accessibilityLabel={t('transactions.importOrScan')} icon="more-vertical" onPress={() => setActionsOpen(true)} style={styles.overflow} />
          ) : undefined}
          helpLabel={false}
          helpText={perAccount ? undefined : t('transactions.help')}
          provenance={perAccount ? undefined : freshnessLine}
          title={t('transactions.title')}
        />
      </View>
      <OptionSheet
        mode="menu"
        onClose={() => setActionsOpen(false)}
        onSelect={runSecondary}
        options={secondaryActions}
        title={t('transactions.importOrScan')}
        visible={actionsOpen}
      />

      {lead && !perAccount ? (
        <TransactionsLead
          currency={leadCurrency}
          data={lead}
          locale={locale}
          onReview={() => onFiltersChange({ ...filters, needsReview: true })}
          reviewDisabled={scopeLocked}
          viewTotal={total ?? loaded.length}
        />
      ) : null}

      <View style={styles.ledgerControls}>
        <View accessibilityLabel={t('transactions.filters')} style={styles.controlRow}>
          <UiButton
            accessibilityLabel={`${t('transactions.dateRange')}, ${rangeLabel}`}
            disabled={scopeLocked}
            icon="calendar"
            label={rangeLabel}
            onPress={() => setRangeOpen(true)}
            size="sm"
            style={styles.flex}
            variant="secondary"
          />
          <UiButton
            accessibilityLabel={filtersLabel}
            count={advancedFilterCount}
            countTone="secondary"
            icon="filter"
            label={t('transactions.filtersTitle')}
            onPress={() => setFiltersOpen(true)}
            size="sm"
            variant="secondary"
          />
        </View>
        {state.status === 'refresh-error' ? (
          <View accessibilityRole="alert" style={[styles.notice, { borderColor: palette.border }]}>
            <Text variant="meta">{t('transactions.stale')}</Text>
            <UiButton label={t('common.retry')} onPress={onRefresh} size="sm" variant="outline" />
          </View>
        ) : null}
        {resultMessage ? <Text accessibilityRole="alert" style={[styles.notice, { borderColor: palette.border }]} variant="meta">{resultMessage}</Text> : null}
        {deleteNotice ? (
          <View accessibilityRole="alert" style={[styles.notice, { borderColor: palette.border }]}>
            <Text variant="meta">{t('transactions.bulk.deleted', { count: deleteNotice.deleted })}</Text>
            {deleteNotice.skippedIds.length > 0 ? (
              <>
                <Text variant="meta">{t('transactions.bulk.skipped', { count: deleteNotice.skippedIds.length })}</Text>
                {onSetHidden ? <UiButton disabled={mutationPending} label={t('transactions.bulk.hideSkipped')} onPress={() => void hideIds(deleteNotice.skippedIds)} size="sm" variant="outline" /> : null}
              </>
            ) : null}
            <UiButton label={t('transactions.close')} onPress={() => setDeleteNotice(null)} size="sm" variant="ghost" />
          </View>
        ) : null}
      </View>

      <Sheet
        closeLabel={t('transactions.close')}
        onClose={() => setRangeOpen(false)}
        title={t('transactions.dateRange')}
        visible={rangeOpen}
      >
        <View accessibilityLabel={t('transactions.dateRange')} accessibilityRole="radiogroup">
          {([...RANGE_PRESETS, 'all'] as const).map((value, index) => {
            const checked = period === value
            const label = value === 'all' ? t('transactions.allDates') : t(`transactions.last${value}Days`)
            return (
              <Pressable
                accessibilityLabel={label}
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: scopeLocked }}
                disabled={scopeLocked}
                key={String(value)}
                onPress={() => choosePeriod(value)}
                style={({ pressed }) => [styles.option, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }]}
              >
                <Text style={styles.flex} tone={checked ? 'primary' : 'default'} variant={checked ? 'bodyStrong' : 'body'}>{label}</Text>
                {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
              </Pressable>
            )
          })}
        </View>
        <Divider />
        <View style={styles.sheetSection}>
          <Text accessibilityRole="header" variant="metaStrong">{t('transactions.customRange')}</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateCell}><DateField disabled={scopeLocked} label={t('transactions.customRangeFrom')} maximumDate={customToDraft ?? undefined} onChange={setCustomFromDraft} value={customFromDraft} /></View>
            <View style={styles.dateCell}><DateField disabled={scopeLocked} label={t('transactions.customRangeTo')} minimumDate={customFromDraft ?? undefined} onChange={setCustomToDraft} value={customToDraft} /></View>
          </View>
          {customRangeError ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{customRangeError}</Text> : null}
          <UiButton block disabled={scopeLocked || !customFromDraft || !customToDraft} label={t('transactions.customRangeApply')} onPress={applyCustomRange} />
        </View>
      </Sheet>

      <Sheet
        closeLabel={t('transactions.close')}
        footer={advancedFilterCount > 0 ? <UiButton block disabled={scopeLocked} label={t('transactions.clearAll')} onPress={clearAllFilters} variant="outline" /> : undefined}
        onClose={() => setFiltersOpen(false)}
        title={t('transactions.filtersTitle')}
        visible={filtersOpen}
      >
        <View>
          <ToggleRow disabled={scopeLocked} label={t('transactions.needsReview')} value={filters.needsReview === true} palette={palette} onChange={(value) => onFiltersChange({ ...filters, needsReview: value })} />
          <ToggleRow disabled={scopeLocked} label={t('transactions.showHidden')} value={filters.includeHidden === true} palette={palette} onChange={(value) => onFiltersChange({ ...filters, includeHidden: value })} />
        </View>
        {tags.status === 'loaded' && (tags.tags.length > 0 || tagFilter.length > 0) ? (
          <>
            <Divider />
            {/* Filtered by the server over the whole range, like the toggles above. */}
            <View accessibilityLabel={t('tags.filter')} style={styles.sheetSection}>
              <View style={styles.sectionHead}>
                <Text accessibilityRole="header" variant="metaStrong">{t('tags.filter')}</Text>
                <Text tone="muted" variant="label">{t('tags.filterNote')}</Text>
              </View>
              <View>
                {tags.tags.map((tag, index) => {
                  const checked = tagFilter.includes(tag.tagKey)
                  return (
                    <Pressable
                      accessibilityLabel={t('tags.filterNamed', { name: tag.name })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked, disabled: scopeLocked }}
                      disabled={scopeLocked}
                      key={tag.tagKey}
                      onPress={() => toggleTagFilter(tag.tagKey)}
                      style={({ pressed }) => [styles.option, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }, scopeLocked && styles.dimmed]}
                    >
                      <TagDot color={tag.color} />
                      <Text style={styles.flex} variant="body">{tag.name}</Text>
                      {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </>
        ) : null}
        <Divider />
        <View style={styles.sheetSection}>
          <View style={styles.sectionHead}>
            <Text accessibilityRole="header" variant="metaStrong">{t('transactions.loadedFilters')}</Text>
            <Text tone="muted" variant="label">{t('transactions.loadedFiltersNote')}</Text>
          </View>
          <TextField editable={!scopeLocked} label={t('transactions.merchantFilter')} onChangeText={(value) => { setMerchantFilter(value); setVisibleCount(50) }} placeholder={t('transactions.merchantPlaceholder')} value={merchantFilter} />
          {accountOptions.length > 1 ? <SelectField disabled={scopeLocked} label={t('transactions.accountFilter')} placeholder={t('transactions.allAccounts')} options={[{ value: allAccountsValue, label: t('transactions.allAccounts') }, ...accountOptions.map(([id, name]) => ({ value: id, label: name ?? t('accounts.unnamed') }))]} value={accountFilter ?? allAccountsValue} onChange={(id) => { setAccountFilter(id === allAccountsValue ? null : id); setVisibleCount(50) }} /> : null}
          {categoryOptions.length > 1 ? <SelectField disabled={scopeLocked} label={t('transactions.categoryFilter')} placeholder={t('transactions.allCategories')} options={[{ value: allValue, label: t('transactions.allCategories') }, ...categoryOptions.map((category) => ({ value: category, label: formatCategoryName(category) }))]} value={categoryFilter ?? allValue} onChange={(category) => { setCategoryFilter(category === allValue ? null : category); setVisibleCount(50) }} /> : null}
          {typeOptions.length > 1 ? <SelectField disabled={scopeLocked} label={t('transactions.typeFilter')} placeholder={t('transactions.allTypes')} options={[{ value: allValue, label: t('transactions.allTypes') }, ...typeOptions.map((type) => ({ value: type, label: type }))]} value={typeFilter ?? allValue} onChange={(type) => { setTypeFilter(type === allValue ? null : type); setVisibleCount(50) }} /> : null}
        </View>
      </Sheet>

      <OptionSheet
        mode="menu"
        onClose={() => setRowMenuId(null)}
        onSelect={runRowAction}
        options={rowActions}
        title={menuRow ? (menuRow.title ?? t('transactions.unnamed')) : ''}
        visible={menuRow !== null}
      />

      <OptionSheet
        groups={destinationGroups}
        onClose={() => { if (!transferPending) setDestinationId(null) }}
        onSelect={chooseDestination}
        testID="transfer-destination-sheet"
        title={t('transactions.transfer.destinationTitle')}
        value={destinationRow?.transferDestination ? destinationValue(destinationRow.transferDestination.type, destinationRow.transferDestination.key) : destinationRow?.isTransfer ? 'none' : null}
        visible={destinationRow !== null}
      />

      {tagEditRow && onCreateTag ? (
        <TagPickerSheet
          initial={tagEditRow.tags.map((tag) => tag.tagKey)}
          notice={tagNotice}
          onClose={() => { if (!tagSaving) setTagEditId(null) }}
          onCreate={onCreateTag}
          onSave={(tagIds) => void saveTags(tagIds)}
          pending={tagSaving}
          saveLabel={t('tags.save')}
          tags={tags}
          title={t('tags.editFor', { name: tagEditRow.title ?? t('transactions.unnamed') })}
        />
      ) : null}
    </View>
  )

  const showMoreLocal = visible.length < filtered.length
  const loadMoreServer = !showMoreLocal && serverHasMore && requestLimit < 500
  const footer = (
    <View style={[styles.footerGroup, visible.length > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <Text tone="muted" variant="label">{countLine}</Text>
      {showMoreLocal ? <UiButton disabled={scopeLocked} label={t('transactions.showMore', { count: filtered.length - visible.length })} onPress={() => setVisibleCount((count) => count + 50)} size="sm" variant="outline" /> : null}
      {loadMoreServer ? <UiButton disabled={scopeLocked} label={t('transactions.loadMore')} onPress={() => onFiltersChange({ ...filters, limit: 500 })} size="sm" variant="outline" /> : null}
    </View>
  )
  const emptyKind = accountCount === 0 ? 'noAccount' : loaded.length === 0 ? 'domain' : 'filtered'
  // Selection starts from a row's "…" menu (web has no toolbar toggle at phone
  // width), so the bar shows for the whole of selection mode and carries Done.
  const bulkOpen = selecting
  const noneSelected = selected.length === 0

  return (
    <View style={styles.safe}>
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderRow}
        initialNumToRender={50}
        contentContainerStyle={[styles.content, showCreate && styles.contentUnderButton]}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
        ListEmptyComponent={filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text accessibilityRole="header" variant="bodyStrong">{t(`transactions.empty.${emptyKind}.title`)}</Text>
            <Text tone="muted" variant="meta">{t(`transactions.empty.${emptyKind}.message`)}</Text>
            {emptyKind === 'filtered' ? <UiButton label={t('transactions.clearFilters')} onPress={() => { setAccountFilter(null); setCategoryFilter(null); setTypeFilter(null); setMerchantFilter(''); onFiltersChange({ fromDate: filters.fromDate, toDate: filters.toDate, limit: filters.limit }) }} size="sm" variant="outline" /> : null}
          </View>
        ) : undefined}
      />

      {bulkOpen ? (
        // Web's TransactionReviewControl: a bar pinned under the list while rows are selected.
        <View accessibilityRole="toolbar" accessibilityLabel={t('transactions.bulkActions')} style={[styles.bulkBar, { borderTopColor: palette.border, backgroundColor: palette.popover }, themeTokens.shadow.overlay]}>
          <View style={styles.sectionHead}>
            <Text accessibilityRole="header" variant="metaStrong">{matchingSelected ? t('transactions.bulk.allMatchingSelected', { count: scopeCount }) : t('transactions.selectedCount', { count: selected.length })}</Text>
            <Text tone="muted" variant="label">{matchingSelected ? t('transactions.bulk.matchingScope') : t('transactions.selectionScope')}</Text>
          </View>
          {!everyLoadedSelected && loadedIds.size > 1 ? <UiButton disabled={scopeLocked} label={t('transactions.bulk.selectLoaded', { count: loadedIds.size })} onPress={selectAllLoaded} size="sm" variant="ghost" /> : null}
          {matchingAvailable && !matchingSelected && total !== null ? (
            total > BULK_TRANSACTION_LIMIT
              ? <Text tone="muted" variant="label">{t('transactions.bulk.tooManyMatching', { max: BULK_TRANSACTION_LIMIT })}</Text>
              : <UiButton disabled={scopeLocked} label={t('transactions.bulk.selectAllMatching', { count: total })} onPress={() => setAllMatching(true)} size="sm" variant="outline" />
          ) : null}
          <UiButton block disabled={scopeLocked || noneSelected || !onBulkReview} label={mutationPending ? t('transactions.updating') : t('transactions.reviewSelected')} onPress={reviewSelected} />
          <View style={styles.bulkSecondary}>
            <UiButton disabled={scopeLocked || noneSelected || !onAssignCategory} label={t('transactions.chooseCategory')} onPress={() => setPickerOpen((open) => !open)} size="sm" variant="secondary" />
            {allSelectedVisible ? <UiButton disabled={scopeLocked || !onSetHidden} label={t('transactions.hideSelected')} onPress={() => void setHiddenSelected(true)} size="sm" variant="secondary" /> : null}
            {allSelectedHidden ? <UiButton disabled={scopeLocked || !onSetHidden} label={t('transactions.unhideSelected')} onPress={() => void setHiddenSelected(false)} size="sm" variant="secondary" /> : null}
            {onBulkTag && bulkTagGroups.length > 0 ? <UiButton disabled={scopeLocked || noneSelected} label={t('transactions.bulk.tag')} onPress={() => setBulkTagOpen(true)} size="sm" variant="secondary" /> : null}
            {onBulkDelete ? <UiButton disabled={scopeLocked || noneSelected} label={t('transactions.bulk.delete')} onPress={deleteSelected} size="sm" variant="secondary" /> : null}
            {noneSelected ? null : <UiButton disabled={scopeLocked} label={t('transactions.clearSelection')} onPress={clearSelection} size="sm" variant="ghost" />}
            <UiButton disabled={scopeLocked} label={t('common.done')} onPress={() => { clearSelection(); setSelecting(false) }} size="sm" variant="ghost" />
          </View>
          {pickerOpen ? (
            <ScrollView accessibilityRole="menu" accessibilityLabel={t('transactions.categoryPicker')} style={styles.picker}>
              <Text accessibilityRole="header" variant="metaStrong">{t('transactions.assignCategory')}</Text>
              {categories.status === 'loading' ? <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('transactions.categoriesLoading')}</Text> : null}
              {categories.status === 'error' ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t('transactions.categoriesError')}</Text> : null}
              {categories.status === 'loaded' ? categoryChoices.map((category, index) => (
                <Pressable
                  key={category.id}
                  accessibilityRole="menuitem"
                  accessibilityLabel={t('transactions.assignCategoryNamed', { category: category.name })}
                  disabled={scopeLocked}
                  onPress={() => void assignCategory(category)}
                  style={({ pressed }) => [styles.categoryChoice, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }, scopeLocked && styles.dimmed]}
                >
                  <EntityMark icon={{ name: category.icon, bgColor: category.color }} size="sm" />
                  <Text variant="meta">{category.name}</Text>
                </Pressable>
              )) : null}
            </ScrollView>
          ) : null}
          {confirmation?.type === 'delete' ? (
            <DeleteConfirmation
              confirmation={confirmation}
              pending={mutationPending}
              palette={palette}
              onCancel={() => setConfirmation(null)}
              onConfirm={() => void confirmBulkAction()}
              onHideSynced={onSetHidden && confirmation.synced && confirmation.synced.length > 0 ? () => { const ids = confirmation.synced ?? []; setConfirmation(null); void hideIds(ids) } : undefined}
            />
          ) : confirmation ? (
            <View accessible accessibilityRole="alert" style={[styles.confirmation, { borderTopColor: palette.border }]}>
              <Text accessibilityRole="header" variant="metaStrong">{t(confirmation.type === 'category' ? 'transactions.confirmCategoryTitle' : confirmation.type === 'hidden' ? (confirmation.hidden ? 'transactions.confirmHideTitle' : 'transactions.confirmUnhideTitle') : 'transactions.confirmReviewTitle')}</Text>
              <Text variant="meta">{confirmation.type === 'category'
                ? t('transactions.confirmCategoryMessage', { count: confirmation.count, category: confirmation.category.name })
                : confirmation.type === 'hidden'
                  ? t(confirmation.hidden ? 'transactions.confirmHideMessage' : 'transactions.confirmUnhideMessage', { count: confirmation.count })
                  : t('transactions.confirmReviewMessage', { count: confirmation.count })}</Text>
              <View style={styles.inlineActions}>
                <UiButton disabled={mutationPending} label={t('transactions.cancel')} onPress={() => setConfirmation(null)} variant="secondary" />
                <UiButton disabled={mutationPending} label={mutationPending ? t('transactions.updating') : t(confirmation.type === 'category' ? 'transactions.confirmCategory' : confirmation.type === 'hidden' ? (confirmation.hidden ? 'transactions.confirmHide' : 'transactions.confirmUnhide') : 'transactions.confirmReview')} onPress={confirmBulkAction} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
    <OptionSheet
      groups={bulkTagGroups}
      mode="menu"
      onClose={() => setBulkTagOpen(false)}
      onSelect={(value: string) => void tagSelected(value)}
      title={t('transactions.bulk.tagTitle', { count: scopeCount })}
      visible={bulkTagOpen}
    />
    {deleteRow ? (
      <Sheet
        closeLabel={t('transactions.close')}
        footer={(
          <View style={styles.inlineActions}>
            <UiButton disabled={deleteRowPending} label={t('transactions.cancel')} onPress={() => setDeleteRowId(null)} variant="secondary" />
            {deleteRow.bankSynced
              ? (onSetHidden && !deleteRow.hidden ? <UiButton disabled={deleteRowPending} label={t('transactions.bulk.hideInstead', { count: 1 })} onPress={() => void hideDeleteRow()} /> : null)
              : <UiButton disabled={deleteRowPending} label={deleteRowPending ? t('transactions.updating') : t('transactions.bulk.confirmDelete', { count: 1 })} onPress={() => void confirmDeleteRow()} variant="destructive" />}
          </View>
        )}
        onClose={() => { if (!deleteRowPending) setDeleteRowId(null) }}
        title={deleteRow.bankSynced ? t('transactions.bulk.onlySyncedTitle', { count: 1 }) : t('transactions.bulk.deleteTitle', { count: 1 })}
        visible
      >
        <View style={styles.sheetSection}>
          <Text variant="meta">{deleteRow.title ?? t('transactions.unnamed')}</Text>
          <Text tone="muted" variant="meta">{deleteRow.bankSynced ? t('transactions.bulk.deleteOnlySynced', { count: 1 }) : t('transactions.bulk.deleteMessage')}</Text>
          {deleteRowError ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{deleteRowError}</Text> : null}
        </View>
      </Sheet>
    ) : null}
    {showCreate && onCreate ? <FloatingActionButton accessibilityLabel={t('transactionCreate.action')} onPress={onCreate} testID="transactions-create" /> : null}
    {splitRow ? (
      <TransactionSplitScreen
        categories={categoryChoices}
        error={splitError}
        locale={locale}
        onClose={() => { if (!splitSaving) setSplitId(null) }}
        onRemove={onRemoveSplit ? removeSplit : undefined}
        onSave={saveSplit}
        pending={splitSaving}
        transaction={splitRow}
      />
    ) : null}
    </View>
  )
}

/**
 * The bulk delete's confirmation: the count, and why rows the bank sent are skipped (the next
 * sync would send them again), with hiding offered for them. With every matching row selected the
 * bank rows among them are not known, so it says they are skipped without counting them.
 */
function DeleteConfirmation({ confirmation, pending, palette, onCancel, onConfirm, onHideSynced }: Readonly<{
  confirmation: Extract<FrozenBulkAction, { type: 'delete' }>
  pending: boolean
  palette: Palette
  onCancel: () => void
  onConfirm: () => void
  onHideSynced?: () => void
}>) {
  const { t } = useTranslation()
  const syncedCount = confirmation.synced?.length ?? null
  const deletable = syncedCount === null ? confirmation.count : confirmation.count - syncedCount
  const onlySynced = syncedCount !== null && syncedCount > 0 && deletable === 0
  return (
    <View accessible accessibilityRole="alert" style={[styles.confirmation, { borderTopColor: palette.border }]}>
      <Text accessibilityRole="header" variant="metaStrong">{onlySynced ? t('transactions.bulk.onlySyncedTitle', { count: confirmation.count }) : t('transactions.bulk.deleteTitle', { count: deletable })}</Text>
      <Text variant="meta">{onlySynced ? t('transactions.bulk.deleteOnlySynced', { count: confirmation.count }) : t('transactions.bulk.deleteMessage')}</Text>
      {!onlySynced && syncedCount !== null && syncedCount > 0 ? <Text variant="meta">{t('transactions.bulk.syncedNote', { count: syncedCount })}</Text> : null}
      {syncedCount === null ? <Text variant="meta">{t('transactions.bulk.matchingSyncedNote')}</Text> : null}
      <View style={styles.inlineActions}>
        <UiButton disabled={pending} label={t('transactions.cancel')} onPress={onCancel} variant="secondary" />
        {onHideSynced && syncedCount !== null && syncedCount > 0 ? <UiButton disabled={pending} label={t('transactions.bulk.hideInstead', { count: syncedCount })} onPress={onHideSynced} variant="outline" /> : null}
        {onlySynced ? null : <UiButton disabled={pending} label={pending ? t('transactions.updating') : t('transactions.bulk.confirmDelete', { count: deletable })} onPress={onConfirm} variant="destructive" />}
      </View>
    </View>
  )
}

const isSelectable = (transaction: TransactionViewModel) => !transaction.synthetic && Number.isSafeInteger(transaction.id) && transaction.id > 0

type TransactionRowProps = Readonly<{
  item: TransactionViewModel
  isFirst: boolean
  /** Opens a month: the row carries web's month line ("October 2025") above it. */
  monthStart: boolean
  expanded: boolean
  selecting: boolean
  selected: boolean
  scopeLocked: boolean
  mutationPending: boolean
  reviewing: boolean
  editing: EditingBundle | null
  canEditAmount: boolean
  canEditTags: boolean
  onEditTags: (id: number) => void
  onToggleExpand: (id: number) => void
  onToggleSelect: (id: number) => void
  onMarkReviewed: (id: number) => void
  onStartEditAmount: (item: TransactionViewModel) => void
  onOpenMenu: (id: number) => void
  onCreateRule?: (item: TransactionViewModel) => void
  /** Opens the full-screen split editor for this row. */
  onSplit?: (id: number) => void
  /** Whether the Split action is offered at all (the route provides a handler). */
  canSplit: boolean
  palette: Palette
  locale: string
}>

/**
 * Web's phone ledger row (`MobileTransactionsList`, ledger layout): the name
 * and amount on the first line with the "…" menu after them, then muted
 * lines for account · date and the category, and "Needs review" in warning
 * text. Tapping the row opens its details in place.
 *
 * Memoized so an unrelated state change elsewhere on the screen doesn't make
 * every visible row re-run its date/currency formatting.
 */
const TransactionRow = memo(function TransactionRow({
  item,
  isFirst,
  monthStart,
  expanded,
  selecting,
  selected,
  scopeLocked,
  mutationPending,
  reviewing,
  editing,
  canEditAmount,
  canEditTags,
  onEditTags,
  onToggleExpand,
  onToggleSelect,
  onMarkReviewed,
  onStartEditAmount,
  onOpenMenu,
  onCreateRule,
  onSplit,
  canSplit,
  palette,
  locale,
}: TransactionRowProps) {
  const { hidden: amountsHidden } = usePrivacyMode()
  const { t } = useTranslation()
  // With no exchange rate there is no amount in the user's currency: the row shows its original one.
  const shownValue = item.fx.status === 'missing' ? item.fx.amount : item.amount
  const shownCurrency = item.fx.status === 'missing' ? item.fx.currency : item.currency
  const amount = formatAvailableMoney(shownValue, shownCurrency, locale, t, amountsHidden)
  const signedAmount = shownValue !== null && shownValue > 0 ? `+${amount}` : amount
  const fxCopy = describeFxState(item.fx, t, locale)
  const direction = t(`transactions.${item.direction === 'unknown' ? 'amount' : item.direction}`)
  const fullDate = formatTransactionDate(item.date, locale)
  // The quiet "= 15,55" under the amount while the draft is an expression.
  const amountExpressionHint = editing
    ? (() => {
        const result = amountExpressionResult(editing.amountDraft, locale)
        return result === null ? null : `= ${formatNumberInput(result, locale)}`
      })()
    : null
  const title = item.title ?? t('transactions.unnamed')
  const account = item.accountName ?? t('transactions.accountUnavailable')
  const selectable = selecting && isSelectable(item)
  const editable = isSelectable(item)
  // A split row shows its count in place of the one category, as web's ledger does.
  const splitLabel = item.isSplit ? t('transactions.split.summary', { count: splitCategoryCount(item.splits) }) : null
  const categoryLabel = item.category ? formatCategoryName(item.category) : null
  const figure = shownValue !== null && shownCurrency !== null
    ? <Amount currency={shownCurrency} locale={locale} size="amountBase" value={shownValue} />
    : <Text variant="amountBase">{amount}</Text>

  return (
    // Months are separated by space and a strong heading; rows within a month by hairlines.
    <View style={[!monthStart && { borderTopWidth: 1, borderTopColor: palette.border }, item.hidden && styles.hiddenRow]}>
      {monthStart ? <ListGroupHeading first={isFirst} title={formatMonth(item.date, locale)} variant="heading" /> : null}
      <ListRow
        accessibilityLabel={[title, account, signedAmount, direction, fullDate, splitLabel, fxCopy ? `${fxCopy.label}. ${fxCopy.hint}` : null].filter(Boolean).join(', ')}
        density="comfortable"
        figure={figure}
        leading={selectable ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={t('transactions.selectTransaction', { name: title })}
            accessibilityState={{ checked: selected, disabled: scopeLocked }}
            disabled={scopeLocked}
            hitSlop={12}
            onPress={() => onToggleSelect(item.id)}
            style={({ pressed }) => [styles.checkbox, { borderColor: selected ? palette.primary : palette.input, backgroundColor: selected ? palette.primary : 'transparent' }, (pressed || scopeLocked) && styles.dimmed]}
          >
            {selected ? <Icon color={palette.primaryForeground} name="check" size={14} weight="bold" /> : null}
          </Pressable>
        ) : <EntityMark {...(item.mark ?? { glyph: 'tag' })} testID="transaction-mark" />}
        meta={[`${account} · ${formatShortDate(item.date, locale)}`, splitLabel ?? categoryLabel]}
        moreAccessibilityLabel={t('transactions.rowActions', { name: title })}
        onMorePress={() => onOpenMenu(item.id)}
        // While selecting, the row is the checkbox's larger target; it never
        // opens details then, and a locked selection ignores it.
        onPress={() => { if (!selecting) onToggleExpand(item.id); else if (selectable && !scopeLocked) onToggleSelect(item.id) }}
        title={title}
      >
        {!item.reviewed || item.hidden || fxCopy ? (
          <View style={styles.statusLine}>
            {!item.reviewed ? <Text style={styles.statusText} tone="warning" variant="meta">{t('transactions.needsReview')}</Text> : null}
            {item.hidden ? <Text style={styles.statusText} tone="muted" variant="meta">{t('transactions.hidden')}</Text> : null}
            <FxStatusLabel locale={locale} state={item.fx} testID="transaction-fx-status" />
          </View>
        ) : null}
        <TagChips tags={item.tags} />
      </ListRow>
      {expanded ? (
        <View style={[styles.details, { backgroundColor: palette.muted }]}>
          <Detail label={t('transactions.rawDescription')} value={item.rawDescription ?? t('transactions.unavailable')} />
          <Detail label={t('transactions.settlement')} value={formatAvailableMoney(item.settlementAmount, item.settlementCurrency, locale, t, amountsHidden)} data />
          <Detail label={t('transactions.balanceAfter')} value={formatAvailableMoney(item.balance, item.balanceCurrency, locale, t, amountsHidden)} data />
          <Detail label={t('transactions.convertedBalanceAfter')} value={formatAvailableMoney(item.convertedBalance, item.convertedBalanceCurrency, locale, t, amountsHidden)} data />
          {item.isTransfer ? <Detail label={t('transactions.transfer.label')} value={transferDetail(item, t)} /> : null}
          {!item.isTransfer && !item.categoryCountsAsSpending ? <Detail label={t('transactions.transfer.spendingLabel')} value={t('transactions.transfer.notSpending')} /> : null}
          {item.recurring ? <Detail label={t('transactions.recurring')} value={`${item.recurring.displayName} · ${t(`transactions.recurringType.${item.recurring.type}`)}`} /> : null}
          {item.isSplit ? (
            <View style={styles.detail}>
              <Text tone="muted" variant="label">{t('transactions.split.lines')}</Text>
              <View style={styles.splitLines}>
                {item.splits.map((line) => (
                  <View key={line.transactionSplitKey} style={styles.splitLine}>
                    <View style={styles.flex}>
                      <Text variant="meta">{line.category ? displayCategoryName(line.category, t) : t('transactions.split.uncategorized')}</Text>
                      {line.notes ? <Text tone="muted" variant="label">{line.notes}</Text> : null}
                    </View>
                    <Amount
                      currency={line.appuserAmount != null ? item.currency : item.settlementCurrency}
                      locale={locale}
                      size="amountSmall"
                      value={line.appuserAmount ?? line.amount}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {item.tags.length > 0 ? (
            <View style={styles.detail}>
              <Text tone="muted" variant="label">{t('tags.title')}</Text>
              <TagChips max={50} tags={item.tags} />
            </View>
          ) : null}
          {item.repayment ? <Detail label={t('transactions.repayment')} value={t('transactions.repaymentValue', { name: item.repayment.loanName, amount: formatAvailableMoney(item.repayment.spendingAmount, item.currency, locale, t, amountsHidden) })} /> : null}
          {editable ? <TransactionAttachmentsSection transactionId={item.id} /> : null}
          {editable && canEditAmount && editing ? (
            <View style={styles.amountEdit}>
              <TextField
                editable={!editing.amountSubmitting}
                hint={amountExpressionHint}
                keyboardType="numbers-and-punctuation"
                label={t('transactions.editAmountInput')}
                invalid={editing.amountInvalid}
                onBlur={() => {
                  const result = amountExpressionResult(editing.amountDraft, locale)
                  if (result !== null) editing.onAmountChange(formatNumberInput(result, locale))
                }}
                onChangeText={editing.onAmountChange}
                value={editing.amountDraft}
              />
              {editing.amountInvalid ? <FormNotice tone="destructive">{t('transactions.editAmountInvalid')}</FormNotice> : null}
              <TextField
                editable={!editing.amountSubmitting}
                label={t('transactions.editDescriptionInput')}
                multiline
                onChangeText={editing.onDescriptionChange}
                placeholder={t('transactions.descriptionPlaceholder')}
                value={editing.descriptionDraft}
              />
              <View style={styles.inlineActions}>
                <UiButton disabled={editing.amountSubmitting} label={t('transactions.cancel')} onPress={editing.onCancel} variant="secondary" />
                <UiButton disabled={editing.amountSubmitting || !editing.amountReadable} label={editing.amountSubmitting ? t('transactions.updating') : t('transactions.saveAmount')} onPress={() => editing.onSave(item.id)} />
              </View>
            </View>
          ) : (
            <View style={styles.inlineActions}>
              {editable && !item.reviewed ? (
                <UiButton
                  disabled={mutationPending || reviewing}
                  label={reviewing ? t('transactions.markingReviewed') : t('transactions.markReviewed')}
                  onPress={() => onMarkReviewed(item.id)}
                  size="sm"
                />
              ) : null}
              {editable && canEditAmount ? (
                <UiButton disabled={mutationPending} icon="pencil" label={t('transactions.editAmount')} onPress={() => onStartEditAmount(item)} size="sm" variant="secondary" />
              ) : null}
              {editable && canEditTags ? (
                <UiButton disabled={mutationPending} icon="tag" label={t('tags.edit')} onPress={() => onEditTags(item.id)} size="sm" variant="secondary" />
              ) : null}
              {editable && onCreateRule ? (
                <UiButton disabled={mutationPending} icon="sliders-horizontal" label={t('rules.createFromTransaction')} onPress={() => onCreateRule(item)} size="sm" variant="secondary" />
              ) : null}
              {editable && canSplit && onSplit && canSplitTransaction(item) ? (
                <UiButton disabled={mutationPending} icon="split" label={item.isSplit ? t('transactions.split.edit') : t('transactions.split.action')} onPress={() => onSplit(item.id)} size="sm" variant="secondary" />
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </View>
  )
})

function formatAvailableMoney(
  value: number | null,
  currency: string | null,
  locale: string,
  t: (key: string) => string,
  amountsHidden: boolean,
): string {
  if (value === null && currency === null) return t('transactions.amountAndCurrencyUnavailable')
  if (value === null) return t('transactions.amountUnavailable')
  if (currency === null) {
    const number = amountsHidden ? PRIVACY_MASK : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    return `${number} · ${t('transactions.currencyUnavailable')}`
  }
  return formatMoneyForDisplay(value, { locale, currency }, amountsHidden)
}

/** "To <name>" for an outgoing transfer with a destination; otherwise that it is left out of totals. */
function transferDetail(item: TransactionViewModel, t: TFunction): string {
  const destination = item.transferDestination
  if (!destination) return t('transactions.transfer.excluded')
  return t('transactions.transfer.to', { name: destination.name ?? t(`transactions.transfer.destinationGroups.${destination.type}`) })
}

function Detail({ label, value, data = false }: { label: string; value: string; data?: boolean }) {
  return (
    <View style={styles.detail}>
      <Text tone="muted" variant="label">{label}</Text>
      <Text variant={data ? 'amount' : 'meta'}>{value}</Text>
    </View>
  )
}

/** A server filter that is on or off, as one row in the filters sheet. */
function ToggleRow({ label, value, onChange, palette, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; palette: Palette; disabled?: boolean }) {
  return (
    <View style={[styles.toggleRow, disabled && styles.dimmed]}>
      <Text style={styles.flex} variant="body">{label}</Text>
      <Switch accessibilityLabel={label} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} disabled={disabled} onValueChange={onChange} trackColor={{ false: palette.muted, true: palette.primary }} value={value} />
    </View>
  )
}

function Loading({ palette, label, onBack, perAccount, accountName }: { palette: Palette; label: string; onBack: () => void; perAccount: boolean; accountName?: string | null }) {
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <View style={styles.loading}>
        {perAccount ? <BackControl destination={accountName ?? undefined} fallback="/accounts" onPress={onBack} /> : null}
        <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loadingBars}>
          {[160, 358, 240, 320, 320].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }, index === 1 && styles.skeletonButton]} />)}
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8], width: '100%', maxWidth: 760, alignSelf: 'center' },
  // Title, figures and the control row sit close: the list is the page.
  headerGroup: { width: '100%', gap: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[2] },
  titleBlock: { gap: themeTokens.spacing[3] },
  // The glyph's 44pt target overhangs the title row so the drawn glyph sits on the gutter.
  overflow: { marginRight: -11, marginVertical: -6 },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  ledgerControls: { gap: themeTokens.spacing[3] },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  footerGroup: { width: '100%', alignItems: 'flex-start', gap: themeTokens.spacing[3], paddingTop: themeTokens.spacing[3] },
  option: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  sheetSection: { gap: themeTokens.spacing[3] },
  sectionHead: { gap: themeTokens.spacing[1] },
  toggleRow: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  dateCell: { flexGrow: 1, flexBasis: 140 },
  hiddenRow: { opacity: 0.5 },
  statusLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[2], rowGap: themeTokens.spacing[1] },
  statusText: { fontWeight: '500' },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  details: { padding: themeTokens.spacing[4], borderRadius: themeTokens.radius.lg, marginBottom: themeTokens.spacing[3], gap: themeTokens.spacing[3] },
  detail: { gap: 2 },
  splitLines: { gap: themeTokens.spacing[2] },
  splitLine: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  amountEdit: { width: '100%', gap: themeTokens.spacing[3] },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  empty: { width: '100%', alignItems: 'flex-start', paddingVertical: themeTokens.spacing[6], gap: themeTokens.spacing[2] },
  bulkBar: { borderTopWidth: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[3], maxHeight: '60%' },
  bulkSecondary: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  picker: { maxHeight: 240 },
  categoryChoice: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[1] },
  confirmation: { width: '100%', borderTopWidth: 1, paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[3] },
  dimmed: { opacity: 0.5 },
  failure: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[3] },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  loadingBars: { gap: themeTokens.spacing[4] },
  skeleton: { height: 24, maxWidth: '100%', borderRadius: themeTokens.radius.sm },
  skeletonButton: { height: themeTokens.size.control, borderRadius: themeTokens.radius.md },
})

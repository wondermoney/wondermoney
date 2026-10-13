import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import type { ListRenderItemInfo } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PageHeader } from '@/components/ui/page-header'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { BackControl } from '@/components/ui/back-control'

import { CategoryIcon } from '@/features/categories/category-icon'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import type { CategoryViewModel } from '@/features/categories/categories-view-model'

import { parseTransactionDateRange, type TransactionFilters } from './transactions-contract'
import type { TransactionViewModel } from './transactions-view-model'

export type ReviewResult = 'success' | 'demo' | 'mfa' | 'cancelled' | 'network' | 'error'
export type TransactionCategoryState =
  | { status: 'loading' | 'error' }
  | { status: 'loaded'; categories: readonly CategoryViewModel[] }
type FrozenBulkAction =
  | Readonly<{ type: 'review'; transactionIds: readonly number[] }>
  | Readonly<{ type: 'category'; transactionIds: readonly number[]; category: CategoryViewModel }>
  | Readonly<{ type: 'hidden'; transactionIds: readonly number[]; hidden: boolean }>
const LARGE_BULK_THRESHOLD = 10
export type TransactionsViewState =
  | { status: 'loading' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-account' | 'access-transition' }
  | { status: 'loaded' | 'refresh-error'; transactions: readonly TransactionViewModel[]; refreshing: boolean }

type Props = Readonly<{
  state: TransactionsViewState
  filters: TransactionFilters
  accountCount?: number
  accountName?: string | null
  onBack: () => void
  onCreate?: () => void
  onImport?: () => void
  onScanReceipt?: () => void
  onFiltersChange: (filters: TransactionFilters) => void
  onRefresh: () => void | Promise<void>
  onMarkReviewed: (transactionId: number) => Promise<ReviewResult>
  categories?: TransactionCategoryState
  pending?: boolean
  onBulkReview?: (transactionIds: readonly number[]) => Promise<ReviewResult>
  onAssignCategory?: (transactionIds: readonly number[], categoryId: number) => Promise<ReviewResult>
  onSetHidden?: (transactionIds: readonly number[], hidden: boolean) => Promise<ReviewResult>
  onEditAmount?: (transactionId: number, updatedAmount: string, description?: string) => Promise<ReviewResult>
}>

export function TransactionsScreen(props: Props) {
  const { filters } = props
  const serverScope = `${filters.fromDate ?? ''}|${filters.toDate ?? ''}|${filters.needsReview ?? false}|${filters.includeHidden ?? false}|${filters.limit ?? 100}`
  return <TransactionsContent key={serverScope} {...props} />
}

type EditingBundle = Readonly<{
  transactionId: number
  amountDraft: string
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
  accountCount,
  accountName,
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
  onEditAmount,
}: Props) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
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
  /** How many of the collapsed filters are actually doing something. */
  const advancedFilterCount = [accountFilter !== null, categoryFilter !== null, typeFilter !== null, merchantFilter.trim() !== ''].filter(Boolean).length
  const [customFromDraft, setCustomFromDraft] = useState('')
  const [customToDraft, setCustomToDraft] = useState('')
  const [customRangeError, setCustomRangeError] = useState<string | null>(null)
  // The two filter panels below used to sit permanently between the title and
  // the first transaction — roughly a screenful of controls before any data.
  // They collapse behind one chip, which carries a count so an active filter
  // is never hidden.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(50)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<FrozenBulkAction | null>(null)
  const [submittedAction, setSubmittedAction] = useState<FrozenBulkAction | null>(null)
  const loaded = useMemo(() => 'transactions' in state ? state.transactions : [], [state])
  const accountOptions = useMemo(() => [...new Map(loaded.map((row) => [row.accountId, row.accountName])).entries()], [loaded])
  const categoryOptions = useMemo(() => [...new Set(loaded.map((row) => row.category).filter((value): value is string => Boolean(value)))], [loaded])
  const typeOptions = useMemo(() => [...new Set(loaded.map((row) => row.type).filter((value): value is string => Boolean(value)))], [loaded])
  const categoryChoices = useMemo(() => categories.status === 'loaded'
    ? categories.categories.flatMap((category) => [category, ...category.children])
    : [], [categories])

  // Stable per-row callbacks: kept referentially identical across renders so
  // TransactionRow (React.memo) only re-renders the rows whose own props
  // actually changed, instead of every visible row on every keystroke.
  const toggleExpand = useCallback((id: number) => {
    setExpandedId((current) => (current === id ? null : id))
  }, [])
  const toggleSelect = useCallback((id: number) => {
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
    setEditingAmountId(item.id)
    setAmountDraft(item.settlementAmount !== null ? String(item.settlementAmount) : '')
    setDescriptionDraft(item.description ?? '')
  }, [])
  const cancelEditAmount = useCallback(() => {
    setEditingAmountId(null)
    setAmountDraft('')
    setDescriptionDraft('')
  }, [])
  const saveEditAmount = useCallback((id: number) => {
    if (!onEditAmount) return
    void (async () => {
      setAmountSubmitting(true)
      setReviewResult(null)
      const result = await onEditAmount(id, amountDraft, descriptionDraft)
      setReviewResult(result)
      setAmountSubmitting(false)
      if (result === 'success') {
        setEditingAmountId(null)
        setAmountDraft('')
        setDescriptionDraft('')
      }
    })()
  }, [onEditAmount, amountDraft, descriptionDraft])

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading palette={palette} label={t('transactions.loading')} onBack={onBack} />
  if (!('transactions' in state)) {
    const key = state.status === 'invalid-response' ? 'invalid'
      : state.status === 'not-found' ? 'notFound'
        : state.status === 'invalid-account' ? 'invalidAccount' : 'error'
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <View style={styles.failure}>
          <BackControl fallback="/accounts" label={t('transactions.back')} onPress={onBack} />
          <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
          <Text accessibilityRole="header" style={[styles.failureTitle, { color: palette.foreground }]}>{t(`transactions.${key}.title`)}</Text>
          <Text style={[styles.body, { color: palette.mutedForeground }]}>{t(`transactions.${key}.message`)}</Text>
          {state.status === 'error' || state.status === 'invalid-response'
            ? <Button label={t('common.retry')} onPress={onRefresh} palette={palette} primary /> : null}
        </View>
      </SafeAreaView>
    )
  }

  const period = filters.fromDate ? 'recent' : 'all'
  const resultMessage = reviewResult && reviewResult !== 'success'
    ? t(`transactions.reviewResult.${reviewResult}`) : null
  const filtered = loaded.filter((row) => (accountFilter === null || row.accountId === accountFilter)
    && (categoryFilter === null || row.category === categoryFilter)
    && (typeFilter === null || row.type === typeFilter)
    && (!merchantFilter.trim() || row.merchant?.toLocaleLowerCase(locale).includes(merchantFilter.trim().toLocaleLowerCase(locale))))
  const visible = filtered.slice(0, visibleCount)
  const requestLimit = filters.limit ?? 100
  const loadedIds = new Set(loaded.filter(isSelectable).map((row) => row.id))
  const selected = [...selectedIds].filter((id) => loadedIds.has(id)).sort((left, right) => left - right)
  const selectedRows = loaded.filter((row) => selectedIds.has(row.id))
  const allSelectedVisible = selectedRows.length > 0 && selectedRows.every((row) => !row.hidden)
  const allSelectedHidden = selectedRows.length > 0 && selectedRows.every((row) => row.hidden)
  const mutationPending = pending || submittedAction !== null
  const scopeLocked = mutationPending || confirmation !== null
  const completeAction = async (submitted: FrozenBulkAction, action: () => Promise<ReviewResult>) => {
    setReviewResult(null)
    setSubmittedAction(submitted)
    try {
      const result = await action()
      setReviewResult(result)
      if (result === 'success') {
        setSelectedIds(new Set())
        setPickerOpen(false)
        setConfirmation(null)
      }
    } finally {
      setSubmittedAction(null)
    }
  }
  const reviewSelected = async () => {
    if (!onBulkReview) return
    const frozen: FrozenBulkAction = { type: 'review', transactionIds: [...selected] }
    if (frozen.transactionIds.length >= LARGE_BULK_THRESHOLD) {
      setConfirmation(frozen)
      return
    }
    await completeAction(frozen, () => onBulkReview(frozen.transactionIds))
  }
  const assignCategory = async (category: CategoryViewModel) => {
    if (!onAssignCategory) return
    const frozen: FrozenBulkAction = { type: 'category', transactionIds: [...selected], category }
    if (frozen.transactionIds.length >= LARGE_BULK_THRESHOLD) {
      setConfirmation(frozen)
      return
    }
    await completeAction(frozen, () => onAssignCategory(frozen.transactionIds, category.id))
  }
  const setHiddenSelected = async (hidden: boolean) => {
    if (!onSetHidden) return
    const frozen: FrozenBulkAction = { type: 'hidden', transactionIds: [...selected], hidden }
    if (frozen.transactionIds.length >= LARGE_BULK_THRESHOLD) {
      setConfirmation(frozen)
      return
    }
    await completeAction(frozen, () => onSetHidden(frozen.transactionIds, hidden))
  }
  const confirmBulkAction = async () => {
    if (!confirmation) return
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
  const applyCustomRange = () => {
    try {
      const range = parseTransactionDateRange(customFromDraft.trim(), customToDraft.trim())
      setCustomRangeError(null)
      onFiltersChange({ ...filters, fromDate: range.fromDate, toDate: range.toDate })
    } catch (error) {
      setCustomRangeError(error instanceof Error ? error.message : t('transactions.customRangeInvalid'))
    }
  }

  const editingBundle: EditingBundle | null = editingAmountId === null ? null : {
    transactionId: editingAmountId,
    amountDraft,
    descriptionDraft,
    amountSubmitting,
    onAmountChange: setAmountDraft,
    onDescriptionChange: setDescriptionDraft,
    onCancel: cancelEditAmount,
    onSave: saveEditAmount,
  }

  const canEditAmount = Boolean(onEditAmount)
  const renderRow = ({ item, index }: ListRenderItemInfo<TransactionViewModel>) => (
    <TransactionRow
      item={item}
      isFirst={index === 0}
      isLast={index === visible.length - 1}
      expanded={expandedId === item.id}
      selected={selectedIds.has(item.id)}
      scopeLocked={scopeLocked}
      mutationPending={mutationPending}
      reviewing={reviewingId === item.id}
      editing={editingBundle && editingBundle.transactionId === item.id ? editingBundle : null}
      canEditAmount={canEditAmount}
      onToggleExpand={toggleExpand}
      onToggleSelect={toggleSelect}
      onMarkReviewed={markReviewed}
      onStartEditAmount={startEditAmount}
      palette={palette}
      locale={locale}
    />
  )

  const header = (
    <View style={styles.headerGroup}>
      <BackControl disabled={mutationPending} fallback="/accounts" onPress={onBack} />
      <PageHeader
        provenance={[
          accountName ?? null,
          t('transactions.resultBoundary', { count: loaded.length, loaded: loaded.length, limit: requestLimit }),
        ].filter(Boolean).join(' · ')}
        title={t('transactions.title')}
      />
      <View style={styles.filters}>
        {onCreate ? <Button label={t('transactionCreate.action')} onPress={onCreate} palette={palette} primary /> : null}
        {onImport ? <Button label={t('transactionImport.action')} onPress={onImport} palette={palette} /> : null}
        {onScanReceipt ? <Button label={t('transactionOcr.action')} onPress={onScanReceipt} palette={palette} /> : null}
      </View>

      <View accessibilityRole="toolbar" accessibilityLabel={t('transactions.filters')} style={styles.filters}>
        <Filter disabled={scopeLocked} label={t('transactions.allDates')} selected={period === 'all'} palette={palette} onPress={() => onFiltersChange({ needsReview: filters.needsReview, limit: filters.limit })} />
        <Filter disabled={scopeLocked} label={t('transactions.last30Days')} selected={period === 'recent'} palette={palette} onPress={() => {
          const from = new Date(); from.setDate(from.getDate() - 30)
          onFiltersChange({ ...filters, fromDate: from.toISOString(), toDate: new Date().toISOString() })
        }} />
        <Filter disabled={scopeLocked} label={t('transactions.needsReview')} selected={filters.needsReview === true} palette={palette} onPress={() => onFiltersChange({ ...filters, needsReview: !filters.needsReview })} />
        <Filter label={t('transactions.moreFilters', { count: advancedFilterCount })} selected={filtersOpen} palette={palette} onPress={() => setFiltersOpen((open) => !open)} />
        <Filter disabled={scopeLocked} label={t('transactions.showHidden')} selected={filters.includeHidden === true} palette={palette} onPress={() => onFiltersChange({ ...filters, includeHidden: !filters.includeHidden })} />
      </View>
      <View style={styles.limitRow}><Filter disabled={scopeLocked} label={t('transactions.load100')} selected={requestLimit === 100} palette={palette} onPress={() => onFiltersChange({ ...filters, limit: 100 })} /><Filter disabled={scopeLocked} label={t('transactions.load500')} selected={requestLimit === 500} palette={palette} onPress={() => onFiltersChange({ ...filters, limit: 500 })} /></View>
      {filtersOpen ? (
        <View style={styles.advanced}>
        <View style={[styles.localFilters, { borderColor: palette.border }]}>
          <Text style={[styles.name, { color: palette.foreground }]}>{t('transactions.customRange')}</Text>
          <Text style={[styles.scope, { color: palette.mutedForeground }]}>{t('transactions.customRangeNote')}</Text>
          <View style={styles.filters}>
            <TextInput accessibilityLabel={t('transactions.customRangeFrom')} accessibilityState={{ disabled: scopeLocked }} editable={!scopeLocked} value={customFromDraft} onChangeText={setCustomFromDraft} placeholder={t('transactions.customRangeDatePlaceholder')} placeholderTextColor={palette.mutedForeground} maxLength={10} style={[styles.search, { color: palette.foreground, borderColor: palette.border }, scopeLocked && styles.pressed]} />
            <TextInput accessibilityLabel={t('transactions.customRangeTo')} accessibilityState={{ disabled: scopeLocked }} editable={!scopeLocked} value={customToDraft} onChangeText={setCustomToDraft} placeholder={t('transactions.customRangeDatePlaceholder')} placeholderTextColor={palette.mutedForeground} maxLength={10} style={[styles.search, { color: palette.foreground, borderColor: palette.border }, scopeLocked && styles.pressed]} />
            <Button disabled={scopeLocked} label={t('transactions.customRangeApply')} palette={palette} onPress={applyCustomRange} />
          </View>
          {customRangeError ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.destructive, borderColor: palette.destructive }]}>{customRangeError}</Text> : null}
        </View>
        <View style={[styles.localFilters, { borderColor: palette.border }]}>
          <Text style={[styles.name, { color: palette.foreground }]}>{t('transactions.loadedFilters')}</Text>
          <Text style={[styles.scope, { color: palette.mutedForeground }]}>{t('transactions.loadedFiltersNote')}</Text>
          <TextInput accessibilityLabel={t('transactions.merchantFilter')} accessibilityState={{ disabled: scopeLocked }} editable={!scopeLocked} value={merchantFilter} onChangeText={(value) => { setMerchantFilter(value); setVisibleCount(50) }} placeholder={t('transactions.merchantPlaceholder')} placeholderTextColor={palette.mutedForeground} style={[styles.search, { color: palette.foreground, borderColor: palette.border }, scopeLocked && styles.pressed]} />
          <View style={styles.filters}><Filter disabled={scopeLocked} label={t('transactions.allAccounts')} selected={accountFilter === null} palette={palette} onPress={() => setAccountFilter(null)} />{accountOptions.map(([id, name]) => <Filter disabled={scopeLocked} key={id} label={name ?? t('accounts.unnamed')} selected={accountFilter === id} palette={palette} onPress={() => { setAccountFilter(id); setVisibleCount(50) }} />)}</View>
          <View style={styles.filters}><Filter disabled={scopeLocked} label={t('transactions.allCategories')} selected={categoryFilter === null} palette={palette} onPress={() => setCategoryFilter(null)} />{categoryOptions.map((category) => <Filter disabled={scopeLocked} key={category} label={category} selected={categoryFilter === category} palette={palette} onPress={() => { setCategoryFilter(category); setVisibleCount(50) }} />)}</View>
          <View style={styles.filters}><Filter disabled={scopeLocked} label={t('transactions.allTypes')} selected={typeFilter === null} palette={palette} onPress={() => setTypeFilter(null)} />{typeOptions.map((type) => <Filter disabled={scopeLocked} key={type} label={type} selected={typeFilter === type} palette={palette} onPress={() => { setTypeFilter(type); setVisibleCount(50) }} />)}</View>
        </View>
        </View>
      ) : null}

      {state.status === 'refresh-error' ? <View accessibilityRole="alert" style={[styles.staleRecovery, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text style={[styles.bannerText, { color: palette.foreground }]}>{t('transactions.stale')}</Text><Button label={t('common.retry')} onPress={onRefresh} palette={palette} primary /></View> : null}
      {resultMessage ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{resultMessage}</Text> : null}

      {selected.length > 0 ? (
        <View accessibilityRole="toolbar" accessibilityLabel={t('transactions.bulkActions')} style={[styles.bulkBar, { borderColor: palette.border, backgroundColor: palette.muted }]}>
          <View style={styles.bulkHeading}>
            <Text accessibilityRole="header" style={[styles.name, { color: palette.foreground }]}>{t('transactions.selectedCount', { count: selected.length })}</Text>
            <Text style={[styles.scope, { color: palette.mutedForeground }]}>{t('transactions.selectionScope')}</Text>
          </View>
          <View style={styles.filters}>
            <Button disabled={scopeLocked || !onBulkReview} label={mutationPending ? t('transactions.updating') : t('transactions.reviewSelected')} palette={palette} primary onPress={reviewSelected} />
            <Button disabled={scopeLocked || !onAssignCategory} label={t('transactions.chooseCategory')} palette={palette} onPress={() => setPickerOpen((open) => !open)} />
            {allSelectedVisible ? <Button disabled={scopeLocked || !onSetHidden} label={t('transactions.hideSelected')} palette={palette} onPress={() => void setHiddenSelected(true)} /> : null}
            {allSelectedHidden ? <Button disabled={scopeLocked || !onSetHidden} label={t('transactions.unhideSelected')} palette={palette} onPress={() => void setHiddenSelected(false)} /> : null}
            <Button disabled={scopeLocked} label={t('transactions.clearSelection')} palette={palette} onPress={() => { setSelectedIds(new Set()); setPickerOpen(false); setConfirmation(null) }} />
          </View>
          {pickerOpen ? (
            <View accessibilityRole="menu" accessibilityLabel={t('transactions.categoryPicker')} style={styles.picker}>
              <Text accessibilityRole="header" style={[styles.name, { color: palette.foreground }]}>{t('transactions.assignCategory')}</Text>
              {categories.status === 'loading' ? <Text accessibilityRole="progressbar" style={[styles.body, { color: palette.mutedForeground }]}>{t('transactions.categoriesLoading')}</Text> : null}
              {categories.status === 'error' ? <Text accessibilityRole="alert" style={[styles.body, { color: palette.mutedForeground }]}>{t('transactions.categoriesError')}</Text> : null}
              {categories.status === 'loaded' ? <View style={styles.categoryGrid}>{categoryChoices.map((category) => <Pressable key={category.id} accessibilityRole="menuitem" accessibilityLabel={t('transactions.assignCategoryNamed', { category: category.name })} disabled={scopeLocked} onPress={() => void assignCategory(category)} style={({ pressed }) => [styles.categoryChoice, { borderColor: palette.border, backgroundColor: palette.card }, (pressed || scopeLocked) && styles.pressed]}><View accessible={false} style={[styles.categorySwatch, { borderColor: palette.border, backgroundColor: category.color ?? palette.primarySoft }]}><CategoryIcon icon={category.icon} size={16} color={palette.foreground} /></View><Text style={[styles.filterText, { color: palette.foreground }]}>{category.name}</Text></Pressable>)}</View> : null}
            </View>
          ) : null}
          {confirmation ? (
            <View accessible accessibilityRole="alert" style={[styles.confirmation, { borderColor: palette.successText }]}>
              <Text accessibilityRole="header" style={[styles.name, { color: palette.foreground }]}>{t(confirmation.type === 'category' ? 'transactions.confirmCategoryTitle' : confirmation.type === 'hidden' ? (confirmation.hidden ? 'transactions.confirmHideTitle' : 'transactions.confirmUnhideTitle') : 'transactions.confirmReviewTitle')}</Text>
              <Text style={[styles.body, { color: palette.foreground }]}>{confirmation.type === 'category'
                ? t('transactions.confirmCategoryMessage', { count: confirmation.transactionIds.length, category: confirmation.category.name })
                : confirmation.type === 'hidden'
                  ? t(confirmation.hidden ? 'transactions.confirmHideMessage' : 'transactions.confirmUnhideMessage', { count: confirmation.transactionIds.length })
                  : t('transactions.confirmReviewMessage', { count: confirmation.transactionIds.length })}</Text>
              <View style={styles.filters}><Button disabled={mutationPending} label={t('transactions.cancel')} palette={palette} onPress={() => setConfirmation(null)} /><Button disabled={mutationPending} label={mutationPending ? t('transactions.updating') : t(confirmation.type === 'category' ? 'transactions.confirmCategory' : confirmation.type === 'hidden' ? (confirmation.hidden ? 'transactions.confirmHide' : 'transactions.confirmUnhide') : 'transactions.confirmReview')} palette={palette} primary onPress={confirmBulkAction} /></View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )

  const footer = (
    <View style={styles.footerGroup}>
      {visible.length < filtered.length ? <Button disabled={scopeLocked} label={t('transactions.showMore', { count: filtered.length - visible.length })} onPress={() => setVisibleCount((count) => count + 50)} palette={palette} /> : null}
    </View>
  )
  const emptyKind = accountCount === 0 ? 'noAccount' : loaded.length === 0 ? 'domain' : 'filtered'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderRow}
        initialNumToRender={50}
        contentContainerStyle={[styles.content, styles.contentWithBottomInset]}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
        ListEmptyComponent={filtered.length === 0 ? (
          <View style={[styles.empty, { borderColor: palette.border }]}>
            <Text accessibilityRole="header" style={[styles.name, { color: palette.foreground }]}>{t(`transactions.empty.${emptyKind}.title`)}</Text>
            <Text style={[styles.body, { color: palette.mutedForeground }]}>{t(`transactions.empty.${emptyKind}.message`)}</Text>
            {emptyKind === 'noAccount' ? <View style={styles.filters}>
              {onCreate ? <Button label={t('transactionCreate.action')} onPress={onCreate} palette={palette} primary /> : null}
              {onImport ? <Button label={t('transactionImport.action')} onPress={onImport} palette={palette} /> : null}
            </View> : null}
            {emptyKind === 'filtered' ? <Button label={t('transactions.clearFilters')} onPress={() => onFiltersChange({ limit: filters.limit })} palette={palette} /> : null}
          </View>
        ) : null}
      />
    </SafeAreaView>
  )
}

const isSelectable = (transaction: TransactionViewModel) => !transaction.synthetic && Number.isSafeInteger(transaction.id) && transaction.id > 0

type TransactionRowProps = Readonly<{
  item: TransactionViewModel
  isFirst: boolean
  isLast: boolean
  expanded: boolean
  selected: boolean
  scopeLocked: boolean
  mutationPending: boolean
  reviewing: boolean
  editing: EditingBundle | null
  canEditAmount: boolean
  onToggleExpand: (id: number) => void
  onToggleSelect: (id: number) => void
  onMarkReviewed: (id: number) => void
  onStartEditAmount: (item: TransactionViewModel) => void
  palette: Palette
  locale: string
}>

/**
 * RAD-193 — extracted and memoized so an unrelated state change elsewhere on
 * the screen (typing in a filter field, toggling another row) doesn't force
 * every visible transaction row to re-run its date/currency formatting.
 */
const TransactionRow = memo(function TransactionRow({
  item,
  isFirst,
  isLast,
  expanded,
  selected,
  scopeLocked,
  mutationPending,
  reviewing,
  editing,
  canEditAmount,
  onToggleExpand,
  onToggleSelect,
  onMarkReviewed,
  onStartEditAmount,
  palette,
  locale,
}: TransactionRowProps) {
  const { t } = useTranslation()
  const amount = formatAvailableMoney(item.amount, item.currency, locale, t)
  const signedAmount = item.amount !== null && item.amount > 0 ? `+${amount}` : amount
  const direction = t(`transactions.${item.direction === 'unknown' ? 'amount' : item.direction}`)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(item.date))
  const title = item.title ?? t('transactions.unnamed')
  const account = item.accountName ?? t('transactions.accountUnavailable')
  const selectable = isSelectable(item)
  const editable = !item.synthetic && item.id > 0

  return (
    <View
      style={[
        styles.row,
        { borderColor: palette.border },
        isFirst && styles.rowFirst,
        isLast && styles.rowLast,
        !isFirst && { borderTopWidth: 1, borderTopColor: palette.border },
        item.hidden && styles.hiddenRow,
      ]}
    >
      {selectable ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={t('transactions.selectTransaction', { name: title })}
          accessibilityState={{ checked: selected, disabled: scopeLocked }}
          disabled={scopeLocked}
          onPress={() => onToggleSelect(item.id)}
          style={({ pressed }) => [styles.selectRow, (pressed || scopeLocked) && styles.pressed]}
        >
          <View style={[styles.checkbox, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primary : 'transparent' }]}>
            <Text accessible={false} style={[styles.checkmark, { color: palette.background }]}>{selected ? '✓' : ''}</Text>
          </View>
          <Text style={[styles.meta, { color: palette.mutedForeground }]}>{selected ? t('transactions.selected') : t('transactions.select')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, account, signedAmount, direction, date].join(', ')}
        accessibilityState={{ expanded }}
        onPress={() => onToggleExpand(item.id)}
        style={({ pressed }) => [styles.rowPress, pressed && styles.pressed]}
      >
        <View style={styles.rowMain}>
          <Text style={[styles.name, { color: palette.foreground }]}>{title}</Text>
          <Text style={[styles.meta, { color: palette.mutedForeground }]}>{[account, date].join(' · ')}</Text>
          <Text style={[styles.meta, { color: palette.mutedForeground }]}>{item.category ? formatCategoryName(item.category) : t('transactions.uncategorized')} · {item.reviewed ? t('transactions.reviewed') : t('transactions.needsReview')}{item.hidden ? ` · ${t('transactions.hidden')}` : ''}</Text>
        </View>
        <View style={styles.amountBlock}>
          <Text style={[styles.amount, { color: palette.foreground }]}>{signedAmount}</Text>
          <Text style={[styles.direction, { color: palette.mutedForeground }]}>{direction}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={[styles.details, { backgroundColor: palette.muted }]}>
          <Detail label={t('transactions.rawDescription')} value={item.rawDescription ?? t('transactions.unavailable')} palette={palette} />
          <Detail label={t('transactions.settlement')} value={formatAvailableMoney(item.settlementAmount, item.settlementCurrency, locale, t)} palette={palette} data />
          <Detail label={t('transactions.balanceAfter')} value={formatAvailableMoney(item.balance, item.balanceCurrency, locale, t)} palette={palette} data />
          <Detail label={t('transactions.convertedBalanceAfter')} value={formatAvailableMoney(item.convertedBalance, item.convertedBalanceCurrency, locale, t)} palette={palette} data />
          {item.recurring ? <Detail label={t('transactions.recurring')} value={`${item.recurring.displayName} · ${t(`transactions.recurringType.${item.recurring.type}`)}`} palette={palette} /> : null}
          {item.repayment ? <Detail label={t('transactions.repayment')} value={t('transactions.repaymentValue', { name: item.repayment.loanName, amount: formatAvailableMoney(item.repayment.spendingAmount, item.currency, locale, t) })} palette={palette} /> : null}
          {editable && !item.reviewed ? (
            <Button
              disabled={mutationPending || reviewing}
              label={reviewing ? t('transactions.markingReviewed') : t('transactions.markReviewed')}
              palette={palette}
              primary
              onPress={() => onMarkReviewed(item.id)}
            />
          ) : null}
          {editable && canEditAmount ? (
            editing ? (
              <View style={styles.amountEdit}>
                <TextInput
                  accessibilityLabel={t('transactions.editAmountInput')}
                  editable={!editing.amountSubmitting}
                  keyboardType="numbers-and-punctuation"
                  onChangeText={editing.onAmountChange}
                  style={[styles.search, { color: palette.foreground, borderColor: palette.border }]}
                  value={editing.amountDraft}
                />
                <TextInput
                  accessibilityLabel={t('transactions.editDescriptionInput')}
                  editable={!editing.amountSubmitting}
                  multiline
                  onChangeText={editing.onDescriptionChange}
                  placeholder={t('transactions.descriptionPlaceholder')}
                  placeholderTextColor={palette.mutedForeground}
                  style={[styles.search, { color: palette.foreground, borderColor: palette.border }]}
                  value={editing.descriptionDraft}
                />
                <View style={styles.filters}>
                  <Button disabled={editing.amountSubmitting} label={t('transactions.cancel')} palette={palette} onPress={editing.onCancel} />
                  <Button disabled={editing.amountSubmitting} label={editing.amountSubmitting ? t('transactions.updating') : t('transactions.saveAmount')} palette={palette} primary onPress={() => editing.onSave(item.id)} />
                </View>
              </View>
            ) : (
              <Button disabled={mutationPending} label={t('transactions.editAmount')} palette={palette} onPress={() => onStartEditAmount(item)} />
            )
          ) : null}
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
): string {
  if (value === null && currency === null) return t('transactions.amountAndCurrencyUnavailable')
  if (value === null) return t('transactions.amountUnavailable')
  if (currency === null) {
    const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    return `${number} · ${t('transactions.currencyUnavailable')}`
  }
  return formatCurrency(value, { locale, currency })
}

function Detail({ label, value, palette, data = false }: { label: string; value: string; palette: Palette; data?: boolean }) {
  return <View style={styles.detail}><Text style={[styles.detailLabel, { color: palette.mutedForeground }]}>{label}</Text><Text style={[data ? styles.dataValue : styles.body, { color: palette.foreground }]}>{value}</Text></View>
}
function Filter({ label, selected, palette, onPress, disabled = false }: { label: string; selected: boolean; palette: Palette; onPress: () => void; disabled?: boolean }) {
  // Unselected filter chips carry no border — 8+ of them in a row (date,
  // review, more-filters, hidden, load-more) each individually boxed read
  // as a wall of empty containers. Only an active filter earns a border/fill.
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.filter, selected ? { borderColor: palette.primary, backgroundColor: palette.primarySoft } : { borderWidth: 0, backgroundColor: palette.muted }, disabled && styles.pressed]}><Text style={[styles.filterText, { color: selected ? palette.primary : palette.foreground }]}>{label}</Text></Pressable>
}
function Button({ label, accessibilityLabel, onPress, palette, primary = false, disabled = false }: { label: string; accessibilityLabel?: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled, busy: disabled }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.pressed]}><Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable>
}
function Loading({ palette, label, onBack }: { palette: Palette; label: string; onBack: () => void }) {
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.loading}><BackControl fallback="/accounts" onPress={onBack} color={palette.primary} /><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loadingBars}>{[240, 320, 320].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}</View></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, width: '100%', maxWidth: 760, alignSelf: 'center' }, contentWithBottomInset: { paddingBottom: themeTokens.spacing[5] * 2 },
  headerGroup: { width: '100%', gap: themeTokens.spacing[5], marginBottom: themeTokens.spacing[5] }, footerGroup: { width: '100%', gap: themeTokens.spacing[5], marginTop: themeTokens.spacing[5] },
  heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title }, body: { ...textStyles.body },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, filter: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] }, filterText: { ...textStyles.bodyStrong }, scope: { ...textStyles.label },
  limitRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[2] }, advanced: { width: '100%', gap: themeTokens.layout.sectionGap }, localFilters: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, search: { ...textStyles.body, minHeight: 48, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  row: { width: '100%', borderLeftWidth: 1, borderRightWidth: 1 }, rowFirst: { borderTopWidth: 1, borderTopLeftRadius: themeTokens.radius.lg, borderTopRightRadius: themeTokens.radius.lg }, rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: themeTokens.radius.lg, borderBottomRightRadius: themeTokens.radius.lg, overflow: 'hidden' }, hiddenRow: { opacity: 0.55 }, selectRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], paddingHorizontal: themeTokens.spacing[4], paddingTop: themeTokens.spacing[2] }, checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' }, checkmark: { ...textStyles.action, fontWeight: '700' as const }, rowPress: { minHeight: 92, flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3], padding: themeTokens.spacing[4] }, rowMain: { flex: 1, gap: themeTokens.spacing[1] }, name: { ...textStyles.bodyStrong }, meta: { ...textStyles.meta }, amountBlock: { alignItems: 'flex-end' }, amount: { ...textStyles.amount }, direction: { ...textStyles.label },
  details: { padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] }, detail: { gap: themeTokens.spacing[1] }, detailLabel: { ...textStyles.label }, dataValue: { ...textStyles.amount },
  amountEdit: { width: '100%', gap: themeTokens.spacing[3] },
  empty: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[2] }, banner: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, staleRecovery: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, bannerText: { ...textStyles.body }, bulkBar: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] }, bulkHeading: { gap: themeTokens.spacing[1] }, picker: { width: '100%', gap: themeTokens.spacing[3] }, categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, categoryChoice: { minHeight: 48, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, categorySwatch: { width: 30, height: 30, borderWidth: 1, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' }, categoryGlyph: { ...textStyles.body }, confirmation: { width: '100%', borderWidth: 2, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.action }, pressed: { opacity: 0.65 },
  failure: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] }, failureTitle: { ...textStyles.title }, errorMarker: { width: 36, height: 2 },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] }, loadingBars: { gap: themeTokens.spacing[5] }, skeleton: { height: 24, maxWidth: '100%', borderRadius: themeTokens.radius.sm },
})

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { ListGroupHeading, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { OptionSheet } from '@/components/ui/sheet'
import { Text as UiText } from '@/components/ui/text'
import { usePalette } from '@/theme/use-palette'
import { formatNumberInput, toWireDecimalInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney, useFormatQuantity } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { activeRowFilterCount, filterActivityRows, NO_ROW_FILTERS, PortfolioActivityToolbar, type PortfolioActivityRowFilters } from './portfolio-activity-toolbar'
import type { PortfolioActivityRow } from './portfolio-activity-view-model'
import { type Palette, PortfolioFailure, PortfolioLoading, ScreenAction } from './portfolio-screen-parts'
import type { PortfolioActivityFilters, PortfolioTransactionEditDraft } from './portfolios-contract'
import { classifyDeletePortfolioTransactionFailure, type DeletePortfolioTransactionFailure } from './use-delete-portfolio-transaction'
import { classifyEditPortfolioTransactionFailure, type EditPortfolioTransactionFailure } from './use-edit-portfolio-transaction'

export type PortfolioActivityViewState =
  | { status: 'access-transition' | 'error' | 'invalid-request' | 'invalid-response' | 'loading' | 'not-found' | 'rate-limited' }
  | { status: 'loaded' | 'refresh-error' | 'rate-limited-cached'; rows: readonly PortfolioActivityRow[]; refreshing?: boolean }

export { activityCalendarFilters } from './portfolio-activity-toolbar'

export function formatPortfolioActivityTimestamp(value: string | null, locale: string, unavailable: string): string {
  if (value === null) return unavailable
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function PortfolioActivityScreen({ state, aggregate, filters, onBack, onApplyFilters, onRefresh, onLogout, onDeleteTransaction, onEditTransaction, onAddTransaction, portfolioOptions = [] }: {
  state: PortfolioActivityViewState
  aggregate: boolean
  filters: PortfolioActivityFilters
  onBack: () => void
  /** `all` is the explicit "All dates" choice; with no dates the route opens on the last 60 days. */
  onApplyFilters: (filters: PortfolioActivityFilters, options?: { all?: boolean }) => void
  onRefresh: () => void | Promise<unknown>
  onLogout: () => void | Promise<void>
  onDeleteTransaction?: (transactionKey: number) => Promise<void>
  onEditTransaction?: (transactionKey: number, draft: PortfolioTransactionEditDraft) => Promise<void>
  /** Opens the add flow; on the aggregate page it is given the portfolio picked from `portfolioOptions`. */
  onAddTransaction?: (portfolioId?: number) => void
  portfolioOptions?: readonly { value: number; label: string }[]
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [picking, setPicking] = useState(false)
  const [rowFilters, setRowFilters] = useState<PortfolioActivityRowFilters>(NO_ROW_FILTERS)
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('portfolioActivity.loading')} palette={palette} onBack={aggregate ? undefined : onBack} backLabel={t('portfolioActivity.back')} />
  if (state.status === 'rate-limited') return <RateLimited onBack={onBack} onRetry={onRefresh} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-request' || state.status === 'invalid-response' || state.status === 'not-found') {
    const key = state.status === 'invalid-request' ? 'invalidRequest' : state.status === 'invalid-response' ? 'invalidResponse' : state.status === 'not-found' ? 'notFound' : 'error'
    return <PortfolioFailure title={t(`portfolioActivity.${key}.title`)} message={t(`portfolioActivity.${key}.message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('portfolioActivity.back')} onRetry={onRefresh} onSignOut={onLogout} onBack={onBack} canRetry={state.status === 'error' || state.status === 'invalid-response'} palette={palette} />
  }
  if (!('rows' in state)) return null
  const canAdd = onAddTransaction !== undefined && (!aggregate || portfolioOptions.length > 0)
  const add = () => {
    if (!onAddTransaction) return
    if (!aggregate) onAddTransaction()
    else if (portfolioOptions.length === 1) onAddTransaction(portfolioOptions[0]!.value)
    else setPicking(true)
  }
  const visibleRows = filterActivityRows(state.rows, rowFilters)
  const groups = groupByMonth(visibleRows, locale)
  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, canAdd && styles.contentUnderButton]} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          {/* The aggregate page is a section tab (Overview | Transactions), as web: no back link. */}
          {!aggregate ? <BackControl fallback="/portfolio" onPress={onBack} label={t('portfolioActivity.back')} /> : null}
          <PageHeader title={aggregate ? t('portfolioActivity.aggregateTitle') : t('portfolioActivity.portfolioTitle')} />
          <PortfolioActivityToolbar aggregate={aggregate} filters={filters} onApply={onApplyFilters} onRowFiltersChange={setRowFilters} rowFilters={rowFilters} rows={state.rows} />
          {state.status === 'rate-limited-cached' ? <RateLimitBanner onRetry={onRefresh} palette={palette} /> : null}
          {state.status === 'refresh-error' ? <Notice message={t('portfolioActivity.stale')} /> : null}
          {visibleRows.length === 0 ? (
            <View style={styles.empty}>
              <UiText variant="bodyStrong">{t('portfolioActivity.emptyTitle')}</UiText>
              <UiText tone="muted" variant="meta">{t(state.rows.length > 0 && activeRowFilterCount(rowFilters) > 0 ? 'portfolioActivity.emptyFiltered' : 'portfolioActivity.empty')}</UiText>
              {state.rows.length > 0 && activeRowFilterCount(rowFilters) > 0 ? <View style={styles.emptyAction}><Button label={t('transactions.clearFilters')} onPress={() => setRowFilters(NO_ROW_FILTERS)} size="sm" variant="outline" /></View> : null}
            </View>
          ) : (
            <View style={styles.list}>
              {groups.map((group, index) => (
                <View key={group.key}>
                  <ListGroupHeading first={index === 0} title={group.title} variant="heading" />
                  {group.rows.map((row, rowIndex) => <ActivityRow key={row.id} row={row} locale={locale} palette={palette} separated={rowIndex > 0} onDelete={!aggregate ? onDeleteTransaction : undefined} onEdit={!aggregate ? onEditTransaction : undefined} />)}
                </View>
              ))}
            </View>
          )}
          <UiText tone="muted" variant="meta">{t('portfolioActivity.bounded')}</UiText>
        </View>
      </ScrollView>
      <OptionSheet mode="menu" onClose={() => setPicking(false)} onSelect={(id) => onAddTransaction?.(id)} options={portfolioOptions} title={t('portfolios.selectPortfolio')} visible={picking} />
    </SafeAreaView>
    {canAdd ? <FloatingActionButton accessibilityLabel={t('portfolioActivity.addTransaction')} onPress={add} testID="portfolio-activity-add" /> : null}
    </View>
  )
}

/** Rows under their month ("November 2026"), newest first as the API sends them — web's ledger grouping. */
function groupByMonth(rows: readonly PortfolioActivityRow[], locale: string) {
  const groups: { key: string; title: string; rows: PortfolioActivityRow[] }[] = []
  for (const row of rows) {
    const key = row.timestamp ? row.timestamp.slice(0, 7) : 'unknown'
    let group = groups.find((candidate) => candidate.key === key)
    if (!group) {
      const title = row.timestamp ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(row.timestamp)) : '—'
      group = { key, title, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

function ActivityRow({ row, locale, palette, separated, onDelete, onEdit }: { row: PortfolioActivityRow; locale: string; palette: Palette; separated: boolean; onDelete?: (transactionKey: number) => Promise<void>; onEdit?: (transactionKey: number, draft: PortfolioTransactionEditDraft) => Promise<void> }) {
  const formatMoney = useFormatMoney()
  const formatQuantity = useFormatQuantity()
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [failure, setFailure] = useState<DeletePortfolioTransactionFailure | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editFailure, setEditFailure] = useState<EditPortfolioTransactionFailure | null>(null)
  const [quantityDraft, setQuantityDraft] = useState('')
  const [unitPriceDraft, setUnitPriceDraft] = useState('')
  const [dateDraft, setDateDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const timestamp = formatPortfolioActivityTimestamp(row.timestamp, locale, t('portfolioActivity.unavailable'))
  const type = row.itemType === 'STOCK_SPLIT' ? t('portfolioActivity.stockSplit') : (row.type ? t(`portfolioActivity.types.${row.type}`, { defaultValue: row.typeLabel ?? row.type }) : t('portfolioActivity.unknownType'))
  const amount = row.amount === null ? null : row.currency ? formatMoney(row.amount, { locale, currency: row.currency }) : formatMoney(row.amount, { locale, currency: null, minimumFractionDigits: 0, maximumFractionDigits: 8 })
  const quantity = row.quantity === null ? null : formatQuantity(row.quantity, { locale })
  const completeRatio = row.split !== null && row.split.numerator !== null && row.split.denominator !== null && row.split.ratio !== null
  const ratio = completeRatio ? t('portfolioActivity.splitRatio', { numerator: row.split!.numerator, denominator: row.split!.denominator }) : null
  const ratioDetails = row.itemType === 'STOCK_SPLIT' ? ratio ?? t('portfolioActivity.splitRatioUnavailable') : null
  const identity = row.cashCurrency ? t('portfolioActivity.cash', { currency: row.cashCurrency }) : [row.ticker, row.name].filter(Boolean).join(' · ') || t('portfolioActivity.assetUnavailable')
  const label = [type, identity, timestamp, quantity ? t('portfolioActivity.quantityValue', { value: quantity }) : null, amount, row.currency && !amount ? row.currency : null, row.portfolioName, ratioDetails, row.itemType === 'STOCK_SPLIT' ? t('portfolioActivity.splitReadOnly') : null].filter(Boolean).join(', ')
  const canDelete = onDelete !== undefined && row.itemType === 'TRANSACTION' && row.transactionKey !== null
  const canEdit = onEdit !== undefined && row.itemType === 'TRANSACTION' && row.transactionKey !== null

  const deleteTransaction = () => {
    if (!canDelete || deleting) return
    Alert.alert(
      t('portfolioActivity.deleteConfirmTitle'),
      t('portfolioActivity.deleteConfirmMessage', { name: identity }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('portfolioActivity.delete'), style: 'destructive', onPress: () => {
          setDeleting(true)
          setFailure(null)
          void onDelete!(row.transactionKey!)
            .catch((error: unknown) => { setFailure(classifyDeletePortfolioTransactionFailure(error)) })
            .finally(() => setDeleting(false))
        } },
      ],
      { cancelable: true },
    )
  }

  const startEditing = () => {
    if (!canEdit) return
    setQuantityDraft(row.quantity !== null ? formatNumberInput(row.quantity, locale) : '')
    setUnitPriceDraft(row.unitPrice !== null ? formatNumberInput(row.unitPrice, locale) : '')
    setDateDraft(row.timestamp !== null ? row.timestamp.slice(0, 10) : '')
    setNotesDraft(row.notes ?? '')
    setEditFailure(null)
    setEditing(true)
  }

  const cancelEditing = () => {
    if (saving) return
    setEditing(false)
    setEditFailure(null)
  }

  // Read in the app's language ("1.234,56" in pt and es) and sent as dot decimals.
  const quantityWire = toWireDecimalInput(quantityDraft, locale)
  const unitPriceWire = toWireDecimalInput(unitPriceDraft, locale)
  const unreadable = (draft: string, wire: string) => draft.trim() !== '' && !(Number(wire) > 0)
  const quantityInvalid = unreadable(quantityDraft, quantityWire)
  const unitPriceInvalid = unreadable(unitPriceDraft, unitPriceWire)

  const saveEdit = () => {
    if (!canEdit || saving || quantityInvalid || unitPriceInvalid) return
    const originalDate = row.timestamp !== null ? row.timestamp.slice(0, 10) : ''
    setSaving(true)
    setEditFailure(null)
    void onEdit!(row.transactionKey!, {
      quantity: quantityWire !== String(row.quantity ?? '') ? quantityWire : undefined,
      unitPrice: unitPriceWire !== String(row.unitPrice ?? '') ? unitPriceWire : undefined,
      transactionDate: dateDraft.trim() !== originalDate ? dateDraft : undefined,
      notes: notesDraft.trim() !== (row.notes ?? '') ? notesDraft : undefined,
    })
      .then(() => setEditing(false))
      .catch((error: unknown) => { setEditFailure(classifyEditPortfolioTransactionFailure(error)) })
      .finally(() => setSaving(false))
  }

  const dateLabel = row.timestamp === null ? t('portfolioActivity.unavailable') : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(row.timestamp))
  const title = row.cashCurrency ?? row.ticker ?? identity
  // Edit and delete sit behind the row's "…", as on the account ledger.
  const menu = [
    ...(canEdit && !editing && !deleting ? [{ value: 'edit' as const, label: t('portfolioActivity.edit') }] : []),
    ...(canDelete && !editing && !deleting ? [{ value: 'delete' as const, label: t('portfolioActivity.delete'), destructive: true }] : []),
  ]
  const runMenu = (value: 'edit' | 'delete') => (value === 'edit' ? startEditing() : deleteTransaction())
  return (
    <View style={[styles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      {/* Web's row at phone width: the asset, its type and date beneath; the settlement amount
          right with the quantity under it. */}
      <ListRow
        testID="portfolio-activity-row"
        accessibilityLabel={label}
        density="comfortable"
        onMorePress={menu.length > 0 ? () => setMenuOpen(true) : undefined}
        moreAccessibilityLabel={t('transactions.rowActions', { name: title })}
        leading={<EntityMark {...(row.cashCurrency ? { glyph: 'coins' as const } : assetMark(row.ticker, row.logoUrl))} />}
        title={title}
        meta={[[type, dateLabel].join(' · '), row.cashCurrency ? identity : row.name, row.portfolioName ? t('portfolioActivity.portfolioContext', { name: row.portfolioName }) : null]}
        figure={amount ? <UiText align="right" variant="amount">{amount}</UiText> : row.currency ? <UiText align="right" tone="muted" variant="amount">{row.currency}</UiText> : undefined}
        figureMeta={quantity ? <UiText align="right" tone="muted" variant="amountSmall">{t('portfolioActivity.quantityValue', { value: quantity })}</UiText> : undefined}
      >
        {row.itemType === 'STOCK_SPLIT' ? <UiText tone="muted" variant="metaStrong">{ratioDetails} · {t('portfolioActivity.splitReadOnly')}</UiText> : null}
      </ListRow>
      {failure ? <Notice message={t(`portfolioActivity.deleteFailures.${failure}`)} tone="destructive" /> : null}
      {editing ? (
        <View style={styles.editForm}>
          <FormGroup>
            <FormTextRow editable={!saving} error={quantityInvalid ? t('portfolioTransactionCreate.fieldErrors.quantity') : null} keyboardType="decimal-pad" label={t('portfolioActivity.editQuantity')} onChangeText={setQuantityDraft} value={quantityDraft} />
            <FormTextRow editable={!saving} error={unitPriceInvalid ? t('portfolioTransactionCreate.fieldErrors.unitPrice') : null} keyboardType="decimal-pad" label={t('portfolioActivity.editUnitPrice')} onChangeText={setUnitPriceDraft} value={unitPriceDraft} />
            <DateField appearance="row" disabled={saving} label={t('portfolioActivity.editDate')} onChange={(value) => setDateDraft(value ?? '')} value={dateDraft || null} />
            <FormTextRow editable={!saving} label={t('portfolioActivity.editNotes')} multiline onChangeText={setNotesDraft} value={notesDraft} />
          </FormGroup>
          {editFailure ? <Notice message={t(`portfolioActivity.editFailures.${editFailure}`)} tone="destructive" /> : null}
          <View style={styles.actions}>
            <Button label={t('common.cancel')} onPress={cancelEditing} disabled={saving} size="sm" variant="secondary" />
            <Button label={saving ? t('portfolioActivity.savingEdit') : t('portfolioActivity.saveEdit')} onPress={saveEdit} disabled={saving || quantityInvalid || unitPriceInvalid} size="sm" variant="primary" />
          </View>
        </View>
      ) : null}
      {deleting ? <UiText tone="muted" variant="meta">{t('portfolioActivity.deleting')}</UiText> : null}
      <OptionSheet mode="menu" onClose={() => setMenuOpen(false)} onSelect={runMenu} options={menu} title={title} visible={menuOpen} />
    </View>
  )
}

function RateLimited({ onBack, onRetry, palette }: { onBack: () => void; onRetry: () => void | Promise<unknown>; palette: Palette }) {
  const { t } = useTranslation()
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View style={styles.centered}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('portfolioActivity.rateLimitTitle')}</Text><Text accessibilityRole="alert" style={[styles.body, { color: palette.mutedForeground }]}>{t('portfolioActivity.rateLimitMessage')}</Text><View style={styles.actions}><BackControl fallback="/portfolio" onPress={onBack} label={t('portfolioActivity.back')} /><ScreenAction label={t('portfolioActivity.tryAgain')} onPress={onRetry} palette={palette} primary /></View></View></SafeAreaView>
}

function RateLimitBanner({ onRetry, palette }: { onRetry: () => void | Promise<unknown>; palette: Palette }) {
  const { t } = useTranslation()
  return <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" style={[styles.body, { color: palette.foreground }]}>{t('portfolioActivity.rateLimitCached')}</Text><ScreenAction label={t('portfolioActivity.tryAgain')} onPress={onRetry} palette={palette} /></View>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 800, alignSelf: 'center', gap: themeTokens.spacing[6] },
  title: { ...textStyles.title }, body: { ...textStyles.body },
  // The ledger: months under a 20/600 heading with space above, hairlines between rows, no rules.
  list: { width: '100%' },
  row: { gap: themeTokens.spacing[2], paddingBottom: themeTokens.spacing[1] },
  editForm: { width: '100%', gap: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[3] },
  empty: { width: '100%', gap: themeTokens.spacing[2] },
  emptyAction: { alignItems: 'flex-start' },
  banner: { ...textStyles.meta, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  centered: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', gap: themeTokens.spacing[4], padding: themeTokens.layout.screenPadding },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})

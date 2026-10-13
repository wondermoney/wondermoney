import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioActivityRow } from './portfolio-activity-view-model'
import { type Palette, PortfolioFailure, PortfolioLoading, ScreenAction } from './portfolio-screen-parts'
import type { PortfolioActivityFilters, PortfolioTransactionEditDraft } from './portfolios-contract'
import { classifyDeletePortfolioTransactionFailure, type DeletePortfolioTransactionFailure } from './use-delete-portfolio-transaction'
import { classifyEditPortfolioTransactionFailure, type EditPortfolioTransactionFailure } from './use-edit-portfolio-transaction'

export type PortfolioActivityViewState =
  | { status: 'access-transition' | 'error' | 'invalid-request' | 'invalid-response' | 'loading' | 'not-found' | 'rate-limited' }
  | { status: 'loaded' | 'refresh-error' | 'rate-limited-cached'; rows: readonly PortfolioActivityRow[]; refreshing?: boolean }

export function formatPortfolioActivityTimestamp(value: string | null, locale: string, unavailable: string): string {
  if (value === null) return unavailable
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function activityCalendarFilters(from: string, to: string): PortfolioActivityFilters | null {
  const date = (value: string, end: boolean): string | undefined | null => {
    if (value === '') return undefined
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const suffix = end ? 'T23:59:59.999Z' : 'T00:00:00.000Z'
    const parsed = new Date(`${value}${suffix}`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null
    return parsed.toISOString()
  }
  const fromDate = date(from, false)
  const toDate = date(to, true)
  if (fromDate === null || toDate === null || (fromDate && toDate && fromDate > toDate)) return null
  return { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) }
}

export function PortfolioActivityScreen({ state, aggregate, filters, onBack, onApplyFilters, onRefresh, onLogout, onDeleteTransaction, onEditTransaction, onAddTransaction }: {
  state: PortfolioActivityViewState
  aggregate: boolean
  filters: PortfolioActivityFilters
  onBack: () => void
  onApplyFilters: (filters: PortfolioActivityFilters) => void
  onRefresh: () => void | Promise<unknown>
  onLogout: () => void | Promise<void>
  onDeleteTransaction?: (transactionKey: number) => Promise<void>
  onEditTransaction?: (transactionKey: number, draft: PortfolioTransactionEditDraft) => Promise<void>
  onAddTransaction?: () => void
}) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('portfolioActivity.loading')} palette={palette} onBack={onBack} backLabel={t('portfolioActivity.back')} />
  if (state.status === 'rate-limited') return <RateLimited onBack={onBack} onRetry={onRefresh} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-request' || state.status === 'invalid-response' || state.status === 'not-found') {
    const key = state.status === 'invalid-request' ? 'invalidRequest' : state.status === 'invalid-response' ? 'invalidResponse' : state.status === 'not-found' ? 'notFound' : 'error'
    return <PortfolioFailure title={t(`portfolioActivity.${key}.title`)} message={t(`portfolioActivity.${key}.message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('portfolioActivity.back')} onRetry={onRefresh} onSignOut={onLogout} onBack={onBack} canRetry={state.status === 'error' || state.status === 'invalid-response'} palette={palette} />
  }
  if (!('rows' in state)) return null
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <BackControl fallback="/portfolio" onPress={onBack} color={palette.primary} label={t('portfolioActivity.back')} />
          <View style={styles.heading}>
            <PageHeader
              palette={palette}
            provenance={!aggregate && onDeleteTransaction ? t('portfolioActivity.scopeEditable') : t('portfolioActivity.scope')}
              title={aggregate ? t('portfolioActivity.aggregateTitle') : t('portfolioActivity.portfolioTitle')}
            />
          </View>
          <FilterControls filters={filters} onApply={onApplyFilters} palette={palette} />
          {state.status === 'rate-limited-cached' ? <RateLimitBanner onRetry={onRefresh} palette={palette} /> : null}
          {state.status === 'refresh-error' ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('portfolioActivity.stale')}</Text> : null}
          {state.rows.length === 0 ? <View style={[styles.filters, { borderColor: palette.border, backgroundColor: palette.card }]}><Text style={[styles.rowType, { color: palette.foreground }]}>{t('portfolioActivity.emptyTitle')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('portfolioActivity.empty')}</Text>{!aggregate && onAddTransaction ? <ScreenAction label={t('portfolioActivity.addTransaction')} onPress={onAddTransaction} palette={palette} primary /> : null}</View> : (
            <View style={styles.list}>{state.rows.map((row) => <ActivityRow key={row.id} row={row} locale={locale} palette={palette} onDelete={!aggregate ? onDeleteTransaction : undefined} onEdit={!aggregate ? onEditTransaction : undefined} />)}</View>
          )}
          <Text style={[styles.caption, { color: palette.mutedForeground }]}>{t('portfolioActivity.bounded')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function FilterControls({ filters, onApply, palette }: { filters: PortfolioActivityFilters; onApply: (filters: PortfolioActivityFilters) => void; palette: Palette }) {
  const { t } = useTranslation()
  const [from, setFrom] = useState(filters.fromDate?.slice(0, 10) ?? '')
  const [to, setTo] = useState(filters.toDate?.slice(0, 10) ?? '')
  const [invalid, setInvalid] = useState(false)
  const apply = () => {
    const result = activityCalendarFilters(from.trim(), to.trim())
    setInvalid(result === null)
    if (result) onApply(result)
  }
  return <View style={[styles.filters, { borderWidth: 0, backgroundColor: palette.muted }]}>
    <Text accessibilityRole="header" style={[styles.rowType, { color: palette.foreground }]}>{t('portfolioActivity.filters')}</Text>
    <Text style={[styles.caption, { color: palette.mutedForeground }]}>{t('portfolioActivity.filterHint')}</Text>
    <View style={styles.filterFields}>
      <View style={styles.field}><Text nativeID="portfolio-from-label" style={[styles.caption, { color: palette.foreground }]}>{t('portfolioActivity.fromDate')}</Text><TextInput accessibilityLabelledBy="portfolio-from-label" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" inputMode="numeric" style={[styles.input, { color: palette.foreground, borderColor: palette.border }]} /></View>
      <View style={styles.field}><Text nativeID="portfolio-to-label" style={[styles.caption, { color: palette.foreground }]}>{t('portfolioActivity.toDate')}</Text><TextInput accessibilityLabelledBy="portfolio-to-label" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" autoCapitalize="none" inputMode="numeric" style={[styles.input, { color: palette.foreground, borderColor: palette.border }]} /></View>
    </View>
    {invalid ? <Text accessibilityRole="alert" style={[styles.caption, { color: palette.destructive }]}>{t('portfolioActivity.invalidDates')}</Text> : null}
    <View style={styles.actions}><ScreenAction label={t('portfolioActivity.applyDates')} onPress={apply} palette={palette} /><ScreenAction label={t('portfolioActivity.clearDates')} onPress={() => { setFrom(''); setTo(''); setInvalid(false); onApply({}) }} palette={palette} /></View>
  </View>
}

function ActivityRow({ row, locale, palette, onDelete, onEdit }: { row: PortfolioActivityRow; locale: string; palette: Palette; onDelete?: (transactionKey: number) => Promise<void>; onEdit?: (transactionKey: number, draft: PortfolioTransactionEditDraft) => Promise<void> }) {
  const { t } = useTranslation()
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
  const type = row.itemType === 'STOCK_SPLIT' ? t('portfolioActivity.stockSplit') : (row.type ? formatCategoryName(row.type) : t('portfolioActivity.unknownType'))
  const amount = row.amount === null ? null : row.currency ? `${formatCurrency(row.amount, { locale, currency: row.currency })}` : new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(row.amount)
  const quantity = row.quantity === null ? null : new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(row.quantity)
  const completeRatio = row.split !== null && row.split.numerator !== null && row.split.denominator !== null && row.split.ratio !== null
  const ratio = completeRatio ? t('portfolioActivity.splitRatio', { numerator: row.split!.numerator, denominator: row.split!.denominator }) : null
  const ratioDetails = row.itemType === 'STOCK_SPLIT' ? ratio ?? t('portfolioActivity.splitRatioUnavailable') : null
  const identity = [row.ticker, row.name].filter(Boolean).join(' · ') || t('portfolioActivity.assetUnavailable')
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
    setQuantityDraft(row.quantity !== null ? String(row.quantity) : '')
    setUnitPriceDraft(row.unitPrice !== null ? String(row.unitPrice) : '')
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

  const saveEdit = () => {
    if (!canEdit || saving) return
    const originalDate = row.timestamp !== null ? row.timestamp.slice(0, 10) : ''
    setSaving(true)
    setEditFailure(null)
    void onEdit!(row.transactionKey!, {
      quantity: quantityDraft.trim() !== String(row.quantity ?? '') ? quantityDraft : undefined,
      unitPrice: unitPriceDraft.trim() !== String(row.unitPrice ?? '') ? unitPriceDraft : undefined,
      transactionDate: dateDraft.trim() !== originalDate ? dateDraft : undefined,
      notes: notesDraft.trim() !== (row.notes ?? '') ? notesDraft : undefined,
    })
      .then(() => setEditing(false))
      .catch((error: unknown) => { setEditFailure(classifyEditPortfolioTransactionFailure(error)) })
      .finally(() => setSaving(false))
  }

  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <View testID="portfolio-activity-row" accessible accessibilityLabel={label} style={styles.rowContent}>
        <View style={styles.rowMain}>
          <Text style={[styles.rowType, { color: palette.foreground }]}>{type}</Text>
          <Text style={[styles.ticker, { color: palette.foreground }]}>{identity}</Text>
          <Text style={[styles.caption, { color: palette.mutedForeground }]}>{timestamp}</Text>
          {row.portfolioName ? <Text style={[styles.caption, { color: palette.mutedForeground }]}>{t('portfolioActivity.portfolioContext', { name: row.portfolioName })}</Text> : null}
          {row.itemType === 'STOCK_SPLIT' ? <Text style={[styles.readOnly, { color: palette.foreground }]}>{ratioDetails} · {t('portfolioActivity.splitReadOnly')}</Text> : null}
        </View>
        <View style={styles.rowValues}>
          {quantity ? <Text style={[styles.data, { color: palette.mutedForeground }]}>{t('portfolioActivity.quantityValue', { value: quantity })}</Text> : null}
          {amount ? <Text style={[styles.data, { color: palette.foreground }]}>{amount}</Text> : null}
          {row.currency && !amount ? <Text style={[styles.data, { color: palette.mutedForeground }]}>{row.currency}</Text> : null}
        </View>
      </View>
      {failure ? <Text accessibilityRole="alert" style={[styles.deleteFailure, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`portfolioActivity.deleteFailures.${failure}`)}</Text> : null}
      {editing ? (
        <View style={styles.editForm}>
          <View style={styles.editField}><Text nativeID={`portfolio-edit-quantity-${row.id}`} style={[styles.caption, { color: palette.foreground }]}>{t('portfolioActivity.editQuantity')}</Text><TextInput accessibilityLabelledBy={`portfolio-edit-quantity-${row.id}`} editable={!saving} value={quantityDraft} onChangeText={setQuantityDraft} keyboardType="decimal-pad" style={[styles.input, { color: palette.foreground, borderColor: palette.border }]} /></View>
          <View style={styles.editField}><Text nativeID={`portfolio-edit-unit-price-${row.id}`} style={[styles.caption, { color: palette.foreground }]}>{t('portfolioActivity.editUnitPrice')}</Text><TextInput accessibilityLabelledBy={`portfolio-edit-unit-price-${row.id}`} editable={!saving} value={unitPriceDraft} onChangeText={setUnitPriceDraft} keyboardType="decimal-pad" style={[styles.input, { color: palette.foreground, borderColor: palette.border }]} /></View>
          <View style={styles.editField}><Text nativeID={`portfolio-edit-date-${row.id}`} style={[styles.caption, { color: palette.foreground }]}>{t('portfolioActivity.editDate')}</Text><TextInput accessibilityLabelledBy={`portfolio-edit-date-${row.id}`} editable={!saving} value={dateDraft} onChangeText={setDateDraft} placeholder="YYYY-MM-DD" autoCapitalize="none" inputMode="numeric" style={[styles.input, { color: palette.foreground, borderColor: palette.border }]} /></View>
          <View style={styles.editField}><Text nativeID={`portfolio-edit-notes-${row.id}`} style={[styles.caption, { color: palette.foreground }]}>{t('portfolioActivity.editNotes')}</Text><TextInput accessibilityLabelledBy={`portfolio-edit-notes-${row.id}`} editable={!saving} value={notesDraft} onChangeText={setNotesDraft} multiline style={[styles.input, styles.multiline, { color: palette.foreground, borderColor: palette.border }]} /></View>
          {editFailure ? <Text accessibilityRole="alert" style={[styles.deleteFailure, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`portfolioActivity.editFailures.${editFailure}`)}</Text> : null}
          <View style={styles.actions}>
            <ScreenAction label={t('common.cancel')} onPress={cancelEditing} palette={palette} disabled={saving} />
            <ScreenAction label={saving ? t('portfolioActivity.savingEdit') : t('portfolioActivity.saveEdit')} onPress={saveEdit} palette={palette} disabled={saving} />
          </View>
        </View>
      ) : canEdit ? <ScreenAction label={t('portfolioActivity.edit')} onPress={startEditing} palette={palette} disabled={deleting} /> : null}
      {canDelete && !editing ? <ScreenAction label={deleting ? t('portfolioActivity.deleting') : t('portfolioActivity.delete')} onPress={deleteTransaction} palette={palette} disabled={deleting} destructive /> : null}
    </View>
  )
}

function RateLimited({ onBack, onRetry, palette }: { onBack: () => void; onRetry: () => void | Promise<unknown>; palette: Palette }) {
  const { t } = useTranslation()
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View style={styles.centered}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('portfolioActivity.rateLimitTitle')}</Text><Text accessibilityRole="alert" style={[styles.body, { color: palette.mutedForeground }]}>{t('portfolioActivity.rateLimitMessage')}</Text><View style={styles.actions}><BackControl fallback="/portfolio" onPress={onBack} color={palette.primary} label={t('portfolioActivity.back')} /><ScreenAction label={t('portfolioActivity.tryAgain')} onPress={onRetry} palette={palette} primary /></View></View></SafeAreaView>
}

function RateLimitBanner({ onRetry, palette }: { onRetry: () => void | Promise<unknown>; palette: Palette }) {
  const { t } = useTranslation()
  return <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" style={[styles.body, { color: palette.foreground }]}>{t('portfolioActivity.rateLimitCached')}</Text><ScreenAction label={t('portfolioActivity.tryAgain')} onPress={onRetry} palette={palette} /></View>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 800, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.layout.blockGap }, heading: { width: '100%', gap: themeTokens.spacing[2] }, title: { ...textStyles.title }, body: { ...textStyles.body }, caption: { ...textStyles.meta }, filters: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, filterFields: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, field: { flex: 1, minWidth: 180, gap: themeTokens.spacing[1] }, input: { ...textStyles.amount, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, list: { width: '100%' }, row: { minHeight: 104, gap: themeTokens.spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: themeTokens.spacing[4] }, rowContent: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[4] }, rowMain: { flex: 1, minWidth: 180, gap: themeTokens.spacing[1] }, rowValues: { alignItems: 'flex-end', gap: themeTokens.spacing[1] }, deleteFailure: { ...textStyles.meta, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] }, editForm: { width: '100%', gap: themeTokens.spacing[3] }, editField: { gap: themeTokens.spacing[1] }, multiline: { minHeight: 72, paddingTop: themeTokens.spacing[2], textAlignVertical: 'top' }, rowType: { ...textStyles.action }, ticker: { ...textStyles.amount }, data: { ...textStyles.amount }, readOnly: { ...textStyles.meta, fontWeight: '600' as const }, empty: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5] }, banner: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, centered: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', gap: themeTokens.spacing[4], padding: themeTokens.layout.screenPadding }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
})

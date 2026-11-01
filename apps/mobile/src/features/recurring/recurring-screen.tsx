import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BackControl } from '@/components/ui/back-control'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { RecurringDetectionResult, RecurringMetadataInput } from './recurring-contract'
import type { RecurringMutation } from './use-recurring-mutations'
import type { RecurringRowViewModel, RecurringSummaryViewModel } from './recurring-view-model'

export type RecurringViewState =
  | { status: 'loading' | 'error' | 'invalid-response' | 'access-transition' | 'no-account' }
  | { status: 'loaded' | 'refresh-error'; rows: readonly RecurringRowViewModel[]; summary: RecurringSummaryViewModel | null; refreshing: boolean; itemsUnavailable?: boolean; summaryUnavailable?: boolean }
export type RecurringActionResult = 'success' | 'unknown' | 'demo' | 'mfa' | 'cancelled' | 'network' | 'invalid' | 'access' | 'category' | 'error'
export type RecurringScanResult = RecurringActionResult | { status: 'success'; counts: RecurringDetectionResult }
type CategoryOption = Readonly<{ id: number; name: string }>
type Props = Readonly<{
  state: RecurringViewState
  onBack: () => void
  onRefresh: () => void | Promise<void>
  categories?: readonly CategoryOption[]
  categoriesUnavailable?: boolean
  demoReadOnly?: boolean
  pending?: RecurringMutation | null
  scanNeedsRefresh?: boolean
  onScan?: () => Promise<RecurringScanResult>
  onConfirm?: (id: number) => Promise<RecurringActionResult>
  onDismiss?: (id: number) => Promise<RecurringActionResult>
  onRestore?: (id: number) => Promise<RecurringActionResult>
  onUpdate?: (id: number, metadata: RecurringMetadataInput) => Promise<RecurringActionResult>
}>

export function RecurringScreen({ state, onBack, onRefresh, categories = [], categoriesUnavailable = false, demoReadOnly = false, pending = null, scanNeedsRefresh = false, onScan, onConfirm, onDismiss, onRestore, onUpdate }: Props) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [dismissRow, setDismissRow] = useState<RecurringRowViewModel | null>(null)
  const [editRow, setEditRow] = useState<RecurringRowViewModel | null>(null)
  const [result, setResult] = useState<RecurringActionResult | null>(null)
  const [scanConfirm, setScanConfirm] = useState(false)
  const [scanResult, setScanResult] = useState<RecurringDetectionResult | null>(null)
  const [scanSubmitting, setScanSubmitting] = useState(false)
  const scanLock = useRef(false)
  const run = async (action: (() => Promise<RecurringActionResult>) | undefined) => {
    if (!action) return
    setResult(null)
    const outcome = await action()
    if (outcome !== 'success' && outcome !== 'unknown') setResult(outcome)
  }
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading palette={palette} label={t('recurring.loading')} onBack={onBack} />
  if (!('rows' in state)) {
    const key = state.status === 'invalid-response' ? 'invalid' : state.status === 'no-account' ? 'noAccount' : 'error'
    return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.failure}>
      <BackControl fallback="/accounts" label={t('recurring.back')} onPress={onBack} />
      <View style={[styles.errorMarker, { backgroundColor: state.status === 'no-account' ? palette.mutedForeground : palette.destructive }]} />
      <Text accessibilityRole="header" style={[styles.failureTitle, { color: palette.foreground }]}>{t(`recurring.${key}.title`)}</Text>
      <Text style={[styles.body, { color: palette.mutedForeground }]}>{t(`recurring.${key}.message`)}</Text>
      {state.status !== 'no-account' ? <Button label={t('common.retry')} onPress={onRefresh} palette={palette} primary /> : null}
    </View></SafeAreaView>
  }

  const summary = state.summary
  const checked = summary?.lastDetectedAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.lastDetectedAt)) : null
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
     <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}><View style={styles.page}>
      <BackControl fallback="/accounts" label={t('recurring.back')} onPress={onBack} />
      <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('recurring.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('recurring.helper')}</Text><Text style={[styles.caption, { color: palette.mutedForeground }]}>{checked ? t('recurring.lastChecked', { date: checked }) : t('recurring.neverChecked')}</Text></View>
       {state.status === 'refresh-error' ? <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" style={[styles.bannerText, { color: palette.foreground }]}>{t('recurring.stale')}</Text><Button label={t('common.retry')} onPress={onRefresh} palette={palette} /></View> : null}
      {demoReadOnly ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('recurring.demoReadOnly')}</Text> : null}
       {scanNeedsRefresh ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('recurring.scan.unknown')}</Text> : null}
       {state.itemsUnavailable ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('recurring.itemsUnavailable')}</Text> : null}
       {state.summaryUnavailable ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('recurring.summaryUnavailable')}</Text> : null}
      {scanResult ? <Text accessible accessibilityLiveRegion="polite" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('recurring.scan.result', scanResult)}</Text> : null}
      {result && result !== 'success' ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t(`recurring.actionResult.${result}`)}</Text> : null}

       {summary ? <View style={[styles.summary, { borderColor: palette.border }]}>
        <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t('recurring.monthlySummary')}</Text>
        <SummaryRow label={t('recurring.monthlyTotal')} value={formatAggregateRange(summary.monthlyTotal, summary.monthlyTotal, locale, t)} palette={palette} />
        <SummaryRow label={t('recurring.monthlyRange')} value={formatAggregateRange(summary.monthlyMinTotal, summary.monthlyMaxTotal, locale, t)} palette={palette} />
        <SummaryRow label={t('recurring.subscriptions')} value={formatAggregateRange(summary.subscriptionMinTotal, summary.subscriptionMaxTotal, locale, t)} palette={palette} />
        <SummaryRow label={t('recurring.bills')} value={formatAggregateRange(summary.billMinTotal, summary.billMaxTotal, locale, t)} palette={palette} />
        <SummaryRow label={t('recurring.includedCount')} value={String(summary.detectedIncludedCount)} palette={palette} />
        <SummaryRow label={t('recurring.reviewCount')} value={String(summary.needsReviewCount)} palette={palette} />
        <Text style={[styles.caption, { color: palette.mutedForeground }]}>{t('recurring.summaryCurrencyNote')}</Text>
        {summary.currencyTotals.map((total) => <View key={total.currency} style={styles.currencyGroup}><SummaryRow label={t('recurring.currencyTotal', { currency: total.currency, count: total.count })} value={formatMoney(total.monthlyTotal, total.currency, locale, t)} palette={palette} /><SummaryRow label={t('recurring.currencyRange', { currency: total.currency })} value={formatRange(total.monthlyMinTotal, total.monthlyMaxTotal, total.currency, locale, t)} palette={palette} /></View>)}
       </View> : null}

      <View style={[styles.scanCard, { borderColor: palette.border, backgroundColor: palette.muted }]}><View style={styles.scanCopy}><Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t('recurring.scan.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('recurring.scan.helper')}</Text></View><Button label={pending?.kind === 'detect' ? t('recurring.scan.scanning') : t('recurring.scan.action')} onPress={() => setScanConfirm(true)} palette={palette} primary disabled={demoReadOnly || pending !== null || scanNeedsRefresh || state.refreshing} busy={pending?.kind === 'detect'} /></View>

       {state.rows.length === 0 ? <View style={[styles.empty, { borderColor: palette.border }]}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('recurring.noItems.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('recurring.noItems.message')}</Text></View> : <View style={[styles.list, { borderColor: palette.border }]}>
        {state.rows.map((row, index) => <RecurringRow key={row.id} row={row} index={index} locale={locale} palette={palette} disabled={demoReadOnly || pending !== null || scanNeedsRefresh} onConfirm={() => void run(onConfirm ? () => onConfirm(row.id) : undefined)} onDismiss={() => setDismissRow(row)} onRestore={() => void run(onRestore ? () => onRestore(row.id) : undefined)} onEdit={() => setEditRow(row)} />)}
      </View>}
    </View></ScrollView>
    <ConfirmDismiss row={dismissRow} palette={palette} pending={pending?.kind === 'dismiss' && pending.id === dismissRow?.id} onCancel={() => setDismissRow(null)} onConfirm={async () => { if (!dismissRow || !onDismiss) return; const outcome = await onDismiss(dismissRow.id); if (outcome === 'success') setDismissRow(null); else if (outcome !== 'unknown') setResult(outcome) }} />
    <MetadataEditor row={editRow} categories={categories} categoriesUnavailable={categoriesUnavailable} palette={palette} pending={pending?.kind === 'update' && pending.id === editRow?.id} onCancel={() => setEditRow(null)} onSave={async (metadata) => { if (!editRow || !onUpdate) return; const outcome = await onUpdate(editRow.id, metadata); if (outcome === 'success') setEditRow(null); else if (outcome !== 'unknown') setResult(outcome) }} />
    <ConfirmScan open={scanConfirm} palette={palette} pending={scanSubmitting || pending?.kind === 'detect'} onCancel={() => setScanConfirm(false)} onConfirm={async () => { if (!onScan || scanLock.current) return; scanLock.current = true; setScanSubmitting(true); setResult(null); setScanResult(null); try { const outcome = await onScan(); setScanConfirm(false); if (typeof outcome === 'object') setScanResult(outcome.counts); else if (outcome !== 'unknown') setResult(outcome) } finally { scanLock.current = false; setScanSubmitting(false) } }} />
  </SafeAreaView>
}

function ConfirmScan({ open, palette, pending, onCancel, onConfirm }: { open: boolean; palette: Palette; pending: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const { t } = useTranslation()
  if (!open) return null
  return <View style={styles.scrim}><View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: palette.card }]}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('recurring.scan.confirmTitle')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('recurring.scan.confirmMessage')}</Text><View style={styles.actions}><Button label={t('recurring.scan.cancel')} onPress={onCancel} palette={palette} disabled={pending} /><Button label={pending ? t('recurring.scan.scanning') : t('recurring.scan.confirm')} onPress={onConfirm} palette={palette} primary disabled={pending} busy={pending} /></View></View></View>
}

function RecurringRow({ row, index, locale, palette, disabled, onConfirm, onDismiss, onRestore, onEdit }: { row: RecurringRowViewModel; index: number; locale: string; palette: Palette; disabled: boolean; onConfirm: () => void; onDismiss: () => void; onRestore: () => void; onEdit: () => void }) {
  const { t } = useTranslation()
  const amount = row.amountType === 'variable' ? formatRange(row.amountMin, row.amountMax, row.currency, locale, t) : formatMoney(row.amount, row.currency, locale, t)
  const next = formatDate(row.nextExpectedAt, locale, t('recurring.dateUnavailable'))
  const seen = formatDate(row.lastSeenAt, locale, t('recurring.dateUnavailable'))
  const account = row.accountName ?? (row.accountId ? t('recurring.accountId', { id: row.accountId }) : t('recurring.accountUnavailable'))
  const review = row.needsReview ? t('recurring.needsReview') : row.includedInSummary ? t('recurring.included') : t('recurring.notIncluded')
  return <View style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}>
    <View style={styles.rowTop}><View style={styles.rowMain}><Text style={[styles.rowName, { color: palette.foreground }]}>{row.name}</Text><Text style={[styles.meta, { color: palette.mutedForeground }]}>{t(`recurring.type.${row.type}`)} · {t(`recurring.cadence.${row.cadence}`)} · {t(`recurring.status.${row.status}`)}</Text><Text style={[styles.meta, { color: palette.mutedForeground }]}>{row.categoryName ?? t('recurring.categoryUnavailable')} · {account}</Text></View><Text style={[styles.amount, { color: palette.foreground }]}>{amount}</Text></View>
    <Text style={[styles.meta, { color: palette.mutedForeground }]}>{t('recurring.nextExpectedValue', { date: next })} · {t('recurring.lastSeenValue', { date: seen })}</Text><Text style={[styles.review, { color: row.needsReview ? palette.destructive : palette.mutedForeground }]}>{review}</Text>
    <View style={styles.actions}>{row.status === 'candidate' ? <><Button compact label={t('recurring.confirm')} onPress={onConfirm} palette={palette} primary disabled={disabled} /><Button compact label={t('recurring.dismiss')} onPress={onDismiss} palette={palette} disabled={disabled} /></> : null}{row.status === 'dismissed' ? <Button compact label={t('recurring.restore')} onPress={onRestore} palette={palette} disabled={disabled} /> : null}<Button compact label={t('recurring.edit')} onPress={onEdit} palette={palette} disabled={disabled} /></View>
  </View>
}

function ConfirmDismiss({ row, palette, pending, onCancel, onConfirm }: { row: RecurringRowViewModel | null; palette: Palette; pending: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const { t } = useTranslation()
  if (!row) return null
  return <View style={styles.scrim}><View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: palette.card }]}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('recurring.dismissConfirm.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('recurring.dismissConfirm.message', { name: row.name })}</Text><View style={styles.actions}><Button label={t('recurring.dismissConfirm.keep')} onPress={onCancel} palette={palette} disabled={pending} /><Button label={pending ? t('recurring.dismissing') : t('recurring.dismissConfirm.action')} onPress={onConfirm} palette={palette} primary disabled={pending} /></View></View></View>
}

function MetadataEditor({ row, categories, categoriesUnavailable, palette, pending, onCancel, onSave }: { row: RecurringRowViewModel | null; categories: readonly CategoryOption[]; categoriesUnavailable: boolean; palette: Palette; pending: boolean; onCancel: () => void; onSave: (metadata: RecurringMetadataInput) => Promise<void> }) {
  return row ? <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}><EditorForm key={row.id} row={row} categories={categories} categoriesUnavailable={categoriesUnavailable} palette={palette} pending={pending} onCancel={onCancel} onSave={onSave} /></View> : null
}

function EditorForm({ row, categories, categoriesUnavailable, palette, pending, onCancel, onSave }: { row: RecurringRowViewModel; categories: readonly CategoryOption[]; categoriesUnavailable: boolean; palette: Palette; pending: boolean; onCancel: () => void; onSave: (metadata: RecurringMetadataInput) => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState(row.name)
  const [type, setType] = useState(row.type)
  const [cadence, setCadence] = useState(row.cadence)
  const [amountType, setAmountType] = useState(row.amountType)
  const [amount, setAmount] = useState(row.amount?.toString() ?? '')
  const [min, setMin] = useState(row.amountMin?.toString() ?? '')
  const [max, setMax] = useState(row.amountMax?.toString() ?? '')
  const [categoryKey, setCategoryKey] = useState<number | null>(row.categoryId)
  const [validation, setValidation] = useState<string | null>(null)
  const save = async () => {
    const number = (value: string) => value.trim() === '' ? null : Number(value.replace(',', '.'))
    const expectedAmount = number(amount); const expectedAmountMin = number(min); const expectedAmountMax = number(max)
    if (!name.trim() || name.length > 255) { setValidation(t('recurring.validation.name')); return }
    if ([expectedAmount, expectedAmountMin, expectedAmountMax].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) { setValidation(t('recurring.validation.amount')); return }
    if (amountType === 'variable' && expectedAmountMin !== null && expectedAmountMax !== null && expectedAmountMin > expectedAmountMax) { setValidation(t('recurring.validation.range')); return }
    setValidation(null)
    // A type, cadence or amount type this build doesn't know ('unknown') is left out of the body
    // rather than sent back, so saving a name or category change never overwrites it. An unknown
    // amount type also leaves the amounts alone, since we can't tell which of them it uses.
    await onSave({
      displayName: name,
      ...(type === 'unknown' ? {} : { type }),
      ...(cadence === 'unknown' ? {} : { cadence }),
      categoryKey,
      ...(amountType === 'unknown' ? {} : {
        amountType,
        expectedAmount: amountType === 'fixed' ? expectedAmount : null,
        expectedAmountMin: amountType === 'variable' ? expectedAmountMin : null,
        expectedAmountMax: amountType === 'variable' ? expectedAmountMax : null,
      }),
    })
  }
  return <SafeAreaView accessibilityViewIsModal style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView contentContainerStyle={styles.editor}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('recurring.editor.title')}</Text><Field label={t('recurring.editor.name')} value={name} onChange={setName} palette={palette} />
    <ChoiceGroup label={t('recurring.editor.type')} values={['bill', 'subscription']} selected={type} setSelected={(value) => setType(value as typeof type)} translate={(value) => t(`recurring.type.${value}`)} palette={palette} />
    <ChoiceGroup label={t('recurring.editor.cadence')} values={['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']} selected={cadence} setSelected={(value) => setCadence(value as typeof cadence)} translate={(value) => t(`recurring.cadence.${value}`)} palette={palette} />
    <ChoiceGroup label={t('recurring.editor.amountType')} values={['fixed', 'variable']} selected={amountType} setSelected={(value) => setAmountType(value as typeof amountType)} translate={(value) => t(`recurring.amountType.${value}`)} palette={palette} />
    {amountType === 'fixed' ? <Field label={t('recurring.editor.expectedAmount')} value={amount} onChange={setAmount} palette={palette} numeric /> : <View style={styles.rangeFields}><Field label={t('recurring.editor.minimum')} value={min} onChange={setMin} palette={palette} numeric /><Field label={t('recurring.editor.maximum')} value={max} onChange={setMax} palette={palette} numeric /></View>}
    <Text style={[styles.label, { color: palette.foreground }]}>{t('recurring.editor.category')}</Text>{categoriesUnavailable ? <Text accessibilityRole="alert" style={[styles.body, { color: palette.mutedForeground }]}>{t('recurring.editor.categoriesUnavailable')}</Text> : <View style={styles.choices}><Choice label={t('recurring.editor.noCategory')} selected={categoryKey === null} onPress={() => setCategoryKey(null)} palette={palette} />{categories.map((category) => <Choice key={category.id} label={category.name} selected={categoryKey === category.id} onPress={() => setCategoryKey(category.id)} palette={palette} />)}</View>}
    {validation ? <Text accessibilityRole="alert" style={[styles.body, { color: palette.destructive }]}>{validation}</Text> : null}<View style={styles.actions}><Button label={t('recurring.editor.cancel')} onPress={onCancel} palette={palette} disabled={pending} /><Button label={pending ? t('recurring.editor.saving') : t('recurring.editor.save')} onPress={save} palette={palette} primary disabled={pending} /></View>
  </ScrollView></SafeAreaView>
}

function Field({ label, value, onChange, palette, numeric = false }: { label: string; value: string; onChange: (value: string) => void; palette: Palette; numeric?: boolean }) { return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} inputMode={numeric ? 'decimal' : 'text'} placeholderTextColor={palette.mutedForeground} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} /></View> }
function ChoiceGroup({ label, values, selected, setSelected, translate, palette }: { label: string; values: readonly string[]; selected: string; setSelected: (value: string) => void; translate: (value: string) => string; palette: Palette }) { return <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text><View accessibilityRole="radiogroup" style={styles.choices}>{values.map((value) => <Choice key={value} label={translate(value)} selected={value === selected} onPress={() => setSelected(value)} palette={palette} />)}</View></View> }
function Choice({ label, selected, onPress, palette }: { label: string; selected: boolean; onPress: () => void; palette: Palette }) { return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.choice, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.card }]}><Text style={[styles.meta, { color: palette.foreground }]}>{label}</Text></Pressable> }
function formatDate(value: string | null, locale: string, unavailable: string) { return value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value)) : unavailable }
function formatMoney(value: number | null, currency: string | null, locale: string, t: (key: string) => string) { if (value === null) return t('recurring.amountUnavailable'); if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} · ${t('recurring.currencyUnavailable')}`; return formatCurrency(value, { locale, currency }) }
function formatRange(min: number | null, max: number | null, currency: string | null, locale: string, t: (key: string, values?: Record<string, unknown>) => string) { if (min === null || max === null) return t('recurring.amountUnavailable'); const from = formatMoney(min, currency, locale, t); const to = formatMoney(max, currency, locale, t); return min === max ? from : t('recurring.range', { min: from, max: to }) }
function formatAggregateRange(min: number, max: number, locale: string, t: (key: string, values?: Record<string, unknown>) => string) { const number = (value: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); const values = min === max ? number(min) : t('recurring.range', { min: number(min), max: number(max) }); return t('recurring.acrossCurrencies', { value: values }) }
function SummaryRow({ label, value, palette }: { label: string; value: string; palette: Palette }) { return <View style={styles.summaryRow}><Text style={[styles.meta, { color: palette.mutedForeground }]}>{label}</Text><Text style={[styles.summaryValue, { color: palette.foreground }]}>{value}</Text></View> }
function Button({ label, accessibilityLabel, onPress, palette, primary = false, disabled = false, busy = false, compact = false }: { label: string; accessibilityLabel?: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean; busy?: boolean; compact?: boolean }) { const [focused, setFocused] = useState(false); return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled, busy }} disabled={disabled} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={() => void onPress()} style={({ pressed }) => [styles.button, compact && styles.compactButton, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, focused && { borderWidth: 2, borderColor: palette.foreground }, (pressed || disabled) && styles.pressed]}><Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable> }
function Loading({ palette, label, onBack }: { palette: Palette; label: string; onBack: () => void }) { return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.loading}><BackControl fallback="/accounts" onPress={onBack} color={palette.primary} /><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loadingBars}>{[220, 320, 300].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}</View></View></SafeAreaView> }

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.layout.blockGap }, heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title }, sectionTitle: { ...textStyles.section }, body: { ...textStyles.body }, caption: { ...textStyles.label },
  summary: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, summaryRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, summaryValue: { ...textStyles.amount }, currencyGroup: { gap: themeTokens.spacing[2] }, scanCard: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4], alignItems: 'flex-start' }, scanCopy: { gap: themeTokens.spacing[1] }, list: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' }, row: { padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, rowMain: { flex: 1, gap: themeTokens.spacing[1] }, rowName: { ...textStyles.bodyStrong }, meta: { ...textStyles.meta }, amount: { ...textStyles.amount }, review: { ...textStyles.meta },
  empty: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[2] }, banner: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, bannerText: { ...textStyles.body }, button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, compactButton: { paddingHorizontal: themeTokens.spacing[3] }, buttonText: { ...textStyles.action }, pressed: { opacity: 0.68 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  failure: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] }, failureTitle: { ...textStyles.title }, errorMarker: { width: 36, height: 2 }, loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] }, loadingBars: { gap: themeTokens.spacing[5] }, skeleton: { height: 24, maxWidth: '100%', borderRadius: themeTokens.radius.sm },
  scrim: { position: 'absolute', inset: 0, zIndex: 20, justifyContent: 'center', padding: themeTokens.spacing[5], backgroundColor: themeTokens.colors.light.scrim }, sheet: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] }, editor: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: themeTokens.spacing[5], gap: themeTokens.spacing[5] }, field: { gap: themeTokens.spacing[2], flex: 1 }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, input: { ...textStyles.amount, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] }, rangeFields: { flexDirection: 'row', gap: themeTokens.spacing[3] },
})

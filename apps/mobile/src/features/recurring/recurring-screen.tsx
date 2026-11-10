import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormRow, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { IconButton } from '@/components/ui/icon-button'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { EmptyState, Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { formatNumberInput, parseNumberInput } from '@/lib/formatters/decimal-input'
import { formatMoneyForDisplay } from '@/lib/formatters/money-display'
import { formatRelativeTime } from '@/lib/formatters/relative-time'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'
import { FailureState, LoadingState } from '@/features/accounts/screen-states'

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
  /** Kept for callers; the section tabs carry navigation back to Accounts. */
  onBack: () => void
  onRefresh: () => void | Promise<void>
  onAddAccount?: () => void
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

const CADENCE_PER_MONTH: Record<string, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }
const isCurrency = (value: string | null | undefined): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value)

/**
 * Web's Bills & subscriptions (`accounts/recurring/recurring-client.tsx`) at
 * phone width, in the calm structure: the title with its help glyph and one
 * title-row glyph, "Scan again" (the screen's only secondary action, so its
 * own glyph rather than a one-item menu); the estimated monthly total as the
 * headline figure with "Last checked" as its status line, subscriptions, bills
 * and the review count as rows; then Needs review, Upcoming, Category impact
 * and Payment history as open sections.
 */
export function RecurringScreen({ state, onRefresh, onAddAccount, categories = [], categoriesUnavailable = false, demoReadOnly = false, pending = null, scanNeedsRefresh = false, onScan, onConfirm, onDismiss, onRestore, onUpdate }: Props) {
  const { hidden } = usePrivacyMode()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [dismissRow, setDismissRow] = useState<RecurringRowViewModel | null>(null)
  const [editRow, setEditRow] = useState<RecurringRowViewModel | null>(null)
  const [result, setResult] = useState<RecurringActionResult | null>(null)
  const [scanConfirm, setScanConfirm] = useState(false)
  const [scanResult, setScanResult] = useState<RecurringDetectionResult | null>(null)
  const [scanSubmitting, setScanSubmitting] = useState(false)
  const scanLock = useRef(false)
  // The timeline's "after now" is fixed per mount, as web's server reference time.
  const [now] = useState(() => Date.now())
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const reviewY = useRef(0)
  const run = async (action: (() => Promise<RecurringActionResult>) | undefined) => {
    if (!action) return
    setResult(null)
    const outcome = await action()
    if (outcome !== 'success' && outcome !== 'unknown') setResult(outcome)
  }

  const title = t('recurring.title')
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState label={t('recurring.loading')} />
  if (!('rows' in state)) {
    if (state.status === 'no-account') {
      return (
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.page}>
              <PageHeader helpLabel={false} helpText={t('recurring.subtitle')} title={title} />
              <EmptyState
                action={onAddAccount ? <Button icon="plus" label={t('accountsOverview.addAccount')} onPress={onAddAccount} /> : undefined}
                message={t('recurring.noAccount.message')}
                title={t('recurring.noAccount.title')}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      )
    }
    const key = state.status === 'invalid-response' ? 'invalid' : 'error'
    return <FailureState message={t(`recurring.${key}.message`)} onRetry={onRefresh} title={t(`recurring.${key}.title`)} />
  }

  const summary = state.summary
  // Web's recurring page words this with Intl.RelativeTimeFormat (numeric: 'auto').
  const checked = formatRelativeTime(summary?.lastDetectedAt, t, { style: 'calendar' })
  const checkedLine = checked ? t('recurring.lastChecked', { time: checked }) : t('recurring.neverChecked')
  const writesDisabled = demoReadOnly || pending !== null || scanNeedsRefresh
  const scanBusy = pending?.kind === 'detect'
  const scanDisabled = demoReadOnly || pending !== null || scanNeedsRefresh || state.refreshing
  const scanLabel = scanBusy ? t('recurring.scan.scanning') : t('recurring.scan.action')
  const rows = state.rows
  const reviewRows = rows.filter((row) => row.status === 'candidate' && row.needsReview)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.name.localeCompare(b.name))
  const includedRows = rows.filter((row) => row.includedInSummary)
  const historyRows = rows.filter((row) => !(row.status === 'candidate' && row.needsReview))
  const summaryCurrencies = summary?.currencyTotals.map((total) => total.currency).filter(isCurrency) ?? []
  const itemCurrencies = [...new Set(rows.map((row) => row.currency).filter(isCurrency))]
  const sharedCurrency = summaryCurrencies.length === 1 ? summaryCurrencies[0]! : itemCurrencies.length === 1 ? itemCurrencies[0]! : null
  const currencyOf = (row: RecurringRowViewModel) => (isCurrency(row.currency) ? row.currency : sharedCurrency)

  const rowActions = (row: RecurringRowViewModel) => {
    const actions: React.ReactNode[] = []
    if (row.status === 'candidate') {
      actions.push(<Button accessibilityLabel={t('recurring.confirmMerchant', { merchant: row.name })} disabled={writesDisabled} key="confirm" label={t('recurring.confirm')} onPress={() => void run(onConfirm ? () => onConfirm(row.id) : undefined)} size="sm" />)
      actions.push(<Button accessibilityLabel={t('recurring.notRecurringMerchant', { merchant: row.name })} disabled={writesDisabled} key="dismiss" label={t('recurring.notRecurring')} onPress={() => setDismissRow(row)} size="sm" variant="outline" />)
    } else if (row.status === 'confirmed') {
      actions.push(<Button accessibilityLabel={t('recurring.markNotRecurringMerchant', { merchant: row.name })} disabled={writesDisabled} key="dismiss" label={t('recurring.markNotRecurring')} onPress={() => setDismissRow(row)} size="sm" variant="outline" />)
    } else if (row.status === 'dismissed') {
      actions.push(<Button accessibilityLabel={t('recurring.restoreMerchant', { merchant: row.name })} disabled={writesDisabled} key="restore" label={t('recurring.restore')} onPress={() => void run(onRestore ? () => onRestore(row.id) : undefined)} size="sm" variant="outline" />)
    }
    actions.push(<Button accessibilityLabel={t('recurring.edit')} disabled={writesDisabled} key="edit" label={t('recurring.edit')} onPress={() => setEditRow(row)} size="sm" variant="ghost" />)
    return <View style={styles.rowActions}>{actions}</View>
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
    <ScrollView
      contentContainerStyle={styles.content}
      ref={scrollRef}
      refreshControl={<RefreshControl onRefresh={() => void onRefresh()} refreshing={state.refreshing} tintColor={palette.primary} />}
    >
      <View style={styles.page}>
        <PageHeader
          action={rows.length > 0 ? (
            <IconButton
              accessibilityLabel={scanLabel}
              disabled={scanDisabled}
              icon="refresh-cw"
              loading={scanBusy}
              onPress={() => setScanConfirm(true)}
              style={styles.overflow}
            />
          ) : undefined}
          helpLabel={false}
          helpText={t('recurring.subtitle')}
          // With a summary the check time is the figure's status line instead.
          provenance={rows.length > 0 && summary ? undefined : checkedLine}
          title={title}
        />

        {state.status === 'refresh-error' || demoReadOnly || scanNeedsRefresh || state.itemsUnavailable || state.summaryUnavailable || scanResult || (result && result !== 'success') ? (
          <View style={styles.notices}>
            {state.status === 'refresh-error' ? <Notice action={<Button label={t('common.retry')} onPress={onRefresh} size="sm" variant="outline" />} message={t('recurring.stale')} /> : null}
            {demoReadOnly ? <Notice message={t('recurring.demoReadOnly')} /> : null}
            {scanNeedsRefresh ? <Notice message={t('recurring.scan.unknown')} tone="warning" /> : null}
            {state.itemsUnavailable ? <Notice message={t('recurring.itemsUnavailable')} /> : null}
            {state.summaryUnavailable ? <Notice message={t('recurring.summaryUnavailable')} /> : null}
            {scanResult ? <View accessibilityLiveRegion="polite" accessible style={[styles.quiet, { borderColor: palette.border }]}><Text variant="meta">{t('recurring.scan.result', scanResult)}</Text></View> : null}
            {result && result !== 'success' ? <Notice message={t(`recurring.actionResult.${result}`)} tone="destructive" /> : null}
          </View>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            action={<Button disabled={scanDisabled} icon="refresh-cw" label={scanBusy ? scanLabel : t('recurring.detectRecurring')} loading={scanBusy} onPress={() => setScanConfirm(true)} />}
            message={t(summary?.lastDetectedAt ? 'recurring.emptyScannedDescription' : 'recurring.emptyDescription')}
            title={t('recurring.emptyTitle')}
          />
        ) : (
          <>
            {summary ? (
              <SummaryStats
                checkedLine={checkedLine}
                currency={sharedCurrency}
                locale={locale}
                onReview={reviewRows.length > 0 ? () => scrollRef.current?.scrollTo({ y: reviewY.current, animated: true }) : undefined}
                summary={summary}
              />
            ) : null}

            {reviewRows.length > 0 ? (
              <View onLayout={(event) => { reviewY.current = event.nativeEvent.layout.y }}>
                <Section title={t('recurring.needsReviewTitle')} variant="open">
                  <Text style={styles.sectionNote} tone="muted" variant="meta">{t('recurring.reviewQueueDescription')}</Text>
                  <List>
                    {reviewRows.map((row, index) => {
                      const fallback = row.amount ?? row.averageAmount ?? row.lastAmount
                      const currency = currencyOf(row)
                      const usually = fallback === null
                        ? t('recurring.cadenceBasedEstimate')
                        : t('recurring.usuallyPerCharge', { amount: money(fallback, currency, locale, hidden) })
                      return (
                        <ListRow
                          badge={<StatusBadge row={row} />}
                          density="comfortable"
                          figure={<RecurringAmount currency={currency} locale={locale} row={row} />}
                          leading={<EntityMark initials={row.name} />}
                          figureMeta={<Text tone="muted" variant="label">{t('recurring.paymentsSeen', { count: row.occurrenceCount })}</Text>}
                          key={row.id}
                          meta={[[typeLabel(row, t), cadenceLabel(row, t), usually].filter(Boolean).join(' · ')]}
                          separated={index > 0}
                          title={row.name}
                        >
                          {rowActions(row)}
                        </ListRow>
                      )
                    })}
                  </List>
                </Section>
              </View>
            ) : null}

            <Section title={t('recurring.upcoming')} variant="open">
              <Text style={styles.sectionNote} tone="muted" variant="meta">{t('recurring.timelineDescription')}</Text>
              <Upcoming currencyOf={currencyOf} locale={locale} now={now} rows={includedRows} />
            </Section>

            <Section title={t('recurring.categoryImpact')} variant="open">
              <Text style={styles.sectionNote} tone="muted" variant="meta">{t('recurring.categoryImpactDescription')}</Text>
              <CategoryImpact currencyOf={currencyOf} locale={locale} rows={includedRows} />
            </Section>

            {historyRows.length > 0 ? (
              <Section title={t('recurring.paymentHistory')} variant="open">
                <Text style={styles.sectionNote} tone="muted" variant="meta">{t('recurring.tableDescription')}</Text>
                <List>
                  {historyRows.map((row, index) => (
                    <ListRow
                      badge={<StatusBadge row={row} />}
                      density="comfortable"
                      figure={<RecurringAmount currency={currencyOf(row)} locale={locale} row={row} />}
                      leading={<EntityMark initials={row.name} />}
                      key={row.id}
                      meta={[
                        [row.categoryName ? formatCategoryName(row.categoryName) : t('recurring.uncategorized'), row.accountName].filter(Boolean).join(' · '),
                        [typeLabel(row, t), cadenceLabel(row, t), row.status === 'unknown' ? t('recurring.status.unknown') : null].filter(Boolean).join(' · '),
                      ]}
                      separated={index > 0}
                      title={row.name}
                    >
                      <View style={styles.facts}>
                        <Fact label={t('recurring.nextExpected')} value={formatDate(row.nextExpectedAt, locale)} />
                        <Fact label={t('recurring.lastPaid')} value={formatDate(row.lastSeenAt, locale)} />
                      </View>
                      {rowActions(row)}
                    </ListRow>
                  ))}
                </List>
              </Section>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
    <ConfirmDismiss onCancel={() => setDismissRow(null)} onConfirm={async () => { if (!dismissRow || !onDismiss) return; const outcome = await onDismiss(dismissRow.id); if (outcome === 'success') setDismissRow(null); else if (outcome !== 'unknown') setResult(outcome) }} pending={pending?.kind === 'dismiss' && pending.id === dismissRow?.id} row={dismissRow} />
    <MetadataEditor categories={categories} categoriesUnavailable={categoriesUnavailable} onCancel={() => setEditRow(null)} onSave={async (metadata) => { if (!editRow || !onUpdate) return; const outcome = await onUpdate(editRow.id, metadata); if (outcome === 'success') setEditRow(null); else if (outcome !== 'unknown') setResult(outcome) }} pending={pending?.kind === 'update' && pending.id === editRow?.id} row={editRow} />
    <ConfirmScan onCancel={() => setScanConfirm(false)} onConfirm={async () => { if (!onScan || scanLock.current) return; scanLock.current = true; setScanSubmitting(true); setResult(null); setScanResult(null); try { const outcome = await onScan(); setScanConfirm(false); if (typeof outcome === 'object') setScanResult(outcome.counts); else if (outcome !== 'unknown') setResult(outcome) } finally { scanLock.current = false; setScanSubmitting(false) } }} open={scanConfirm} pending={scanSubmitting || scanBusy} />
  </SafeAreaView>
}

type T = (key: string, values?: Record<string, unknown>) => string
const typeLabel = (row: RecurringRowViewModel, t: T) => t(`recurring.type.${row.type}`)
const cadenceLabel = (row: RecurringRowViewModel, t: T) => t(`recurring.cadence.${row.cadence}`)

function money(value: number, currency: string | null, locale: string, hidden: boolean) {
  return formatMoneyForDisplay(value, { locale, currency: isCurrency(currency) ? currency : null }, hidden)
}

function formatRange(min: number, max: number, currency: string | null, locale: string, hidden: boolean) {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return low === high ? money(low, currency, locale, hidden) : `${money(low, currency, locale, hidden)}–${money(high, currency, locale, hidden)}`
}

function formatDate(value: string | null, locale: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))
}

/** Web's `RecurringAmountDisplay`: the fixed amount, the min–max range, or the average / last charge. */
function amountText(row: RecurringRowViewModel, currency: string | null, locale: string, hidden: boolean): string | null {
  const type = row.amountType === 'unknown'
    ? (row.amountMin !== null || row.amountMax !== null ? 'variable' : row.amount !== null ? 'fixed' : null)
    : row.amountType
  if (type === 'fixed') {
    const value = row.amount ?? row.averageAmount ?? row.lastAmount
    return value === null ? null : money(value, currency, locale, hidden)
  }
  if (row.amountMin !== null && row.amountMax !== null) return formatRange(row.amountMin, row.amountMax, currency, locale, hidden)
  const fallback = row.averageAmount ?? row.lastAmount
  return fallback === null ? null : money(fallback, currency, locale, hidden)
}

function RecurringAmount({ row, currency, locale }: { row: RecurringRowViewModel; currency: string | null; locale: string }) {
  const { hidden } = usePrivacyMode()
  const text = amountText(row, currency, locale, hidden)
  return <Text align="right" tone={text ? 'default' : 'muted'} variant="amount">{text ?? '—'}</Text>
}

/** Web's `RecurringStatusBadge`: neutral for confirmed and detected, amber for needs review. */
function StatusBadge({ row }: { row: RecurringRowViewModel }) {
  const { t } = useTranslation()
  if (row.status === 'unknown') return null
  const key = row.status === 'candidate' ? (row.needsReview ? 'needsReview' : 'detected') : row.status
  const tone: BadgeTone = key === 'needsReview' ? 'warning' : key === 'confirmed' ? 'secondary' : 'muted'
  return <Badge label={t(`recurring.badge.${key}`)} tone={tone} />
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text tone="muted" variant="label">{label}</Text>
      <Text variant="amount">{value}</Text>
    </View>
  )
}

/**
 * Web's `RecurringSummaryCards` in the calm structure: the estimated monthly
 * total leads as the headline figure (a range when the charges vary, which a
 * single figure can't hold, so it is set in the same mono face), with "Last
 * checked" as its status line; subscriptions, bills and the review count
 * follow as flat rows. The review row scrolls to the queue while anything waits.
 */
function SummaryStats({ summary, currency, locale, onReview, checkedLine }: { summary: RecurringSummaryViewModel; currency: string | null; locale: string; onReview?: () => void; checkedLine: string }) {
  const { hidden } = usePrivacyMode()
  const { t } = useTranslation()
  const currencies = summary.currencyTotals
  if (currencies.length > 1) {
    return (
      <View style={styles.summaryBlock}>
        <LeadLabel label={t('recurring.monthlyEstimate')} status={checkedLine} />
        <List>
          {currencies.map((total, index) => (
            <ListRow
              density="comfortable"
              figure={<SummaryFigure>{formatRange(total.monthlyMinTotal, total.monthlyMaxTotal, total.currency, locale, hidden)}</SummaryFigure>}
              key={total.currency}
              separated={index > 0}
              title={t('recurring.currencyTotal', { currency: total.currency, count: total.count })}
            />
          ))}
        </List>
        <Text tone="muted" variant="meta">{t('recurring.mixedCurrencyNote')}</Text>
      </View>
    )
  }
  const range = (min: number, max: number) => <SummaryFigure>{formatRange(min, max, currency, locale, hidden)}</SummaryFigure>
  const none = currencies.length === 0 && summary.monthlyMaxTotal === 0
  const fixedTotal = !none && summary.monthlyMinTotal === summary.monthlyMaxTotal && isCurrency(currency)
  return (
    <View style={styles.summaryBlock} testID="recurring-summary">
      {fixedTotal ? (
        <HeadlineFigure
          currency={currency}
          footer={<Text tone="muted" variant="meta">{t('recurring.estimateHint')}</Text>}
          label={t('recurring.monthlyEstimate')}
          labelIsHeader
          locale={locale}
          size="md"
          status={{ label: checkedLine }}
          value={summary.monthlyMaxTotal}
        />
      ) : (
        <View style={styles.lead}>
          <LeadLabel label={t('recurring.monthlyEstimate')} status={checkedLine} />
          <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} tone={none ? 'muted' : 'default'} variant="figure">
            {none ? '—' : formatRange(summary.monthlyMinTotal, summary.monthlyMaxTotal, currency, locale, hidden)}
          </Text>
          <Text tone="muted" variant="meta">{t('recurring.estimateHint')}</Text>
        </View>
      )}
      <List>
        <ListRow density="comfortable" figure={range(summary.subscriptionMinTotal, summary.subscriptionMaxTotal)} title={t('recurring.subscriptions')} />
        <ListRow density="comfortable" figure={range(summary.billMinTotal, summary.billMaxTotal)} separated title={t('recurring.bills')} />
        <ListRow
          accessibilityLabel={summary.needsReviewCount > 0 && onReview ? t('recurring.reviewActionLabel') : undefined}
          density="comfortable"
          figure={<SummaryFigure>{new Intl.NumberFormat(locale).format(summary.needsReviewCount)}</SummaryFigure>}
          onPress={summary.needsReviewCount > 0 ? onReview : undefined}
          separated
          title={t('recurring.needsReviewTitle')}
        />
      </List>
    </View>
  )
}

/** The figure's label row as `HeadlineFigure` draws it: the label, a muted dot, then the status words. */
function LeadLabel({ label, status }: { label: string; status: string }) {
  const palette = usePalette()
  return (
    <View style={styles.leadLabel}>
      <Text accessibilityRole="header" variant="subheading">{label}</Text>
      <View style={styles.status}>
        <View accessible={false} style={[styles.statusDot, { backgroundColor: palette.mutedForeground }]} />
        <Text tone="muted" variant="meta">{status}</Text>
      </View>
    </View>
  )
}

function SummaryFigure({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <Text align="right" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} tone={muted ? 'muted' : 'default'} variant="amount">{children}</Text>
}

/** Web's `RecurringUpcomingTimeline`: included series due after now, soonest first, on a dotted rail. */
function Upcoming({ rows, currencyOf, locale, now }: { rows: readonly RecurringRowViewModel[]; currencyOf: (row: RecurringRowViewModel) => string | null; locale: string; now: number }) {
  const { hidden } = usePrivacyMode()
  const { t } = useTranslation()
  const palette = usePalette()
  const upcoming = rows
    .filter((row) => row.nextExpectedAt && Date.parse(row.nextExpectedAt) > now)
    .sort((a, b) => Date.parse(a.nextExpectedAt!) - Date.parse(b.nextExpectedAt!))
  if (upcoming.length === 0) return <Text style={styles.emptyLine} tone="muted" variant="meta">{t('recurring.upcomingEmpty')}</Text>
  return (
    <View>
      {upcoming.map((row, index) => (
        <View accessible key={row.id} style={styles.timelineRow}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: palette.primary }]} />
            {index < upcoming.length - 1 ? <View style={[styles.railLine, { backgroundColor: palette.border }]} /> : null}
          </View>
          <View style={styles.timelineBody}>
            <View style={styles.inline}>
              <Text numberOfLines={1} style={styles.shrink} variant="metaStrong">{row.name}</Text>
              <StatusBadge row={row} />
            </View>
            <Text tone="muted" variant="meta">
              {`${t('recurring.expectedAround')} ${formatDate(row.nextExpectedAt, locale)} · ${amountText(row, currencyOf(row), locale, hidden) ?? '—'}`}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

/** Web's `RecurringCategoryImpact`: each category's monthly-normalised range and its share of the total. */
function CategoryImpact({ rows, currencyOf, locale }: { rows: readonly RecurringRowViewModel[]; currencyOf: (row: RecurringRowViewModel) => string | null; locale: string }) {
  const { hidden } = usePrivacyMode()
  const { t } = useTranslation()
  const groups = new Map<string, { label: string; min: number; max: number; count: number; currency: string | null }>()
  for (const row of rows) {
    const currency = currencyOf(row)
    const key = `${row.categoryId ?? row.categoryName ?? 'uncategorized'}::${currency ?? 'unknown'}`
    const multiplier = CADENCE_PER_MONTH[row.cadence] ?? 1
    const base = row.amountMin !== null && row.amountMax !== null
      ? { min: Math.min(row.amountMin, row.amountMax), max: Math.max(row.amountMin, row.amountMax) }
      : { min: row.amount ?? row.averageAmount ?? row.lastAmount ?? 0, max: row.amount ?? row.averageAmount ?? row.lastAmount ?? 0 }
    const group = groups.get(key) ?? { label: row.categoryName ? formatCategoryName(row.categoryName) : t('recurring.uncategorized'), min: 0, max: 0, count: 0, currency }
    group.min += base.min * multiplier
    group.max += base.max * multiplier
    group.count += 1
    groups.set(key, group)
  }
  const sorted = [...groups.values()].sort((a, b) => b.min + b.max - (a.min + a.max))
  if (sorted.length === 0) return <Text style={styles.emptyLine} tone="muted" variant="meta">{t('recurring.categoryImpactEmpty')}</Text>
  const totals = new Map<string, number>()
  for (const group of sorted) totals.set(group.currency ?? 'unknown', (totals.get(group.currency ?? 'unknown') ?? 0) + (group.min + group.max) / 2)
  return (
    <View style={styles.impact}>
      {sorted.map((group) => {
        const total = totals.get(group.currency ?? 'unknown') ?? 0
        const share = total > 0 ? ((group.min + group.max) / 2 / total) * 100 : 0
        const rounded = Math.round(share * 10) / 10
        return (
          <View key={`${group.label}-${group.currency}`} style={styles.impactRow}>
            <View style={styles.inline}>
              <View style={styles.shrink}>
                <Text numberOfLines={1} variant="metaStrong">{group.label}</Text>
                <Text tone="muted" variant="label">{`${t('recurring.paymentCount', { count: group.count })} · ${t('recurring.shareOfTotal', { percentage: rounded })}`}</Text>
              </View>
              <Text variant="amount">{formatRange(group.min, group.max, group.currency, locale, hidden)}</Text>
            </View>
            <ProgressBar value={share} />
          </View>
        )
      })}
    </View>
  )
}

function Dialog({ title, message, children }: { title: string; message: string; children: React.ReactNode }) {
  const palette = usePalette()
  return (
    <View style={[styles.scrim, { backgroundColor: palette.scrim }]}>
      <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: palette.popover, borderColor: palette.border }, themeTokens.shadow.overlay]}>
        <Text accessibilityRole="header" variant="section">{title}</Text>
        <Text tone="muted" variant="meta">{message}</Text>
        <View style={styles.dialogActions}>{children}</View>
      </View>
    </View>
  )
}

function ConfirmScan({ open, pending, onCancel, onConfirm }: { open: boolean; pending: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const { t } = useTranslation()
  if (!open) return null
  return (
    <Dialog message={t('recurring.scan.confirmMessage')} title={t('recurring.scan.confirmTitle')}>
      <Button disabled={pending} label={t('recurring.scan.cancel')} onPress={onCancel} variant="secondary" />
      <Button label={pending ? t('recurring.scan.scanning') : t('recurring.scan.confirm')} loading={pending} onPress={onConfirm} />
    </Dialog>
  )
}

function ConfirmDismiss({ row, pending, onCancel, onConfirm }: { row: RecurringRowViewModel | null; pending: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const { t } = useTranslation()
  if (!row) return null
  return (
    <Dialog message={t('recurring.dismissConfirm.message', { name: row.name })} title={t('recurring.dismissConfirm.title')}>
      <Button disabled={pending} label={t('recurring.dismissConfirm.keep')} onPress={onCancel} variant="secondary" />
      <Button disabled={pending} label={pending ? t('recurring.dismissing') : t('recurring.dismissConfirm.action')} onPress={onConfirm} variant="destructive" />
    </Dialog>
  )
}

function MetadataEditor({ row, categories, categoriesUnavailable, pending, onCancel, onSave }: { row: RecurringRowViewModel | null; categories: readonly CategoryOption[]; categoriesUnavailable: boolean; pending: boolean; onCancel: () => void; onSave: (metadata: RecurringMetadataInput) => Promise<void> }) {
  const palette = usePalette()
  return row ? <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}><EditorForm categories={categories} categoriesUnavailable={categoriesUnavailable} key={row.id} onCancel={onCancel} onSave={onSave} pending={pending} row={row} /></View> : null
}

type Validation = Readonly<{ field: 'name' | 'amount' | 'range'; message: string }>

function EditorForm({ row, categories, categoriesUnavailable, pending, onCancel, onSave }: { row: RecurringRowViewModel; categories: readonly CategoryOption[]; categoriesUnavailable: boolean; pending: boolean; onCancel: () => void; onSave: (metadata: RecurringMetadataInput) => Promise<void> }) {
  const { t, i18n } = useTranslation()
  // Amounts are read in the app's language ("1.234,56" in pt and es).
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const inputOf = (value: number | null | undefined) => (value === null || value === undefined ? '' : formatNumberInput(value, locale))
  const palette = usePalette()
  const [name, setName] = useState(row.name)
  const [type, setType] = useState(row.type)
  const [cadence, setCadence] = useState(row.cadence)
  const [amountType, setAmountType] = useState(row.amountType)
  const [amount, setAmount] = useState(() => inputOf(row.amount))
  const [min, setMin] = useState(() => inputOf(row.amountMin))
  const [max, setMax] = useState(() => inputOf(row.amountMax))
  const [categoryKey, setCategoryKey] = useState<number | null>(row.categoryId)
  const [validation, setValidation] = useState<Validation | null>(null)
  const save = async () => {
    const number = (value: string) => value.trim() === '' ? null : parseNumberInput(value, locale) ?? Number.NaN
    const expectedAmount = number(amount); const expectedAmountMin = number(min); const expectedAmountMax = number(max)
    if (!name.trim() || name.length > 255) { setValidation({ field: 'name', message: t('recurring.validation.name') }); return }
    if ([expectedAmount, expectedAmountMin, expectedAmountMax].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) { setValidation({ field: 'amount', message: t('recurring.validation.amount') }); return }
    if (amountType === 'variable' && expectedAmountMin !== null && expectedAmountMax !== null && expectedAmountMin > expectedAmountMax) { setValidation({ field: 'range', message: t('recurring.validation.range') }); return }
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
  const categoryOptions = [{ value: 0, label: t('recurring.editor.noCategory') }, ...categories.map((category) => ({ value: category.id, label: formatCategoryName(category.name) }))]
  const currentCategory = categoryOptions.find((option) => option.value === (categoryKey ?? 0))?.label ?? row.categoryName ?? t('recurring.editor.noCategory')
  const errorFor = (field: Validation['field']) => (validation?.field === field ? validation.message : null)
  const amountRow = (label: string, value: string, onChange: (next: string) => void, field: Validation['field']) => (
    <FormTextRow editable={!pending} error={errorFor(field)} inputMode="decimal" label={label} onChangeText={onChange} placeholder="0.00" value={value} />
  )
  // A flow inside the screen: the form bar's ✕ closes it, ✓ saves.
  return <SafeAreaView accessibilityViewIsModal style={[styles.safe, { backgroundColor: palette.background }]}>
    <FormBar
      closeDisabled={pending}
      closeLabel={t('recurring.editor.cancel')}
      onClose={onCancel}
      onSave={() => void save()}
      saveDisabled={!name.trim()}
      saveLabel={t('recurring.editor.save')}
      saving={pending}
      title={t('recurring.editor.title')}
    />
    <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
      <FormGroup>
        <FormTextRow editable={!pending} error={errorFor('name')} label={t('recurring.editor.name')} maxLength={255} onChangeText={setName} value={name} />
        <FormSelectRow
          disabled={pending}
          label={t('recurring.editor.type')}
          onChange={(value) => setType(value)}
          options={(['bill', 'subscription'] as const).map((value) => ({ value, label: t(`recurring.type.${value}`) }))}
          placeholder={t('recurring.type.unknown')}
          value={type === 'unknown' ? null : type}
        />
        <FormSelectRow
          disabled={pending}
          label={t('recurring.editor.cadence')}
          onChange={(value) => setCadence(value)}
          options={(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const).map((value) => ({ value, label: t(`recurring.cadence.${value}`) }))}
          placeholder={t('recurring.cadence.unknown')}
          value={cadence === 'unknown' ? null : cadence}
        />
        <FormSelectRow
          disabled={pending}
          label={t('recurring.editor.amountType')}
          onChange={(value) => setAmountType(value)}
          options={(['fixed', 'variable'] as const).map((value) => ({ value, label: t(`recurring.amountType.${value}`) }))}
          placeholder={t('common.unavailable')}
          value={amountType === 'unknown' ? null : amountType}
        />
      </FormGroup>
      <FormGroup>
        {amountType === 'fixed'
          ? amountRow(t('recurring.editor.expectedAmount'), amount, setAmount, 'amount')
          : [
              <View key="min">{amountRow(t('recurring.editor.minimum'), min, setMin, 'amount')}</View>,
              <View key="max">{amountRow(t('recurring.editor.maximum'), max, setMax, 'range')}</View>,
            ]}
      </FormGroup>
      <FormGroup>
        {categoriesUnavailable ? (
          <FormRow disabled hint={t('recurring.editor.categoriesUnavailable')} label={t('recurring.editor.category')} onPress={() => {}} value={currentCategory} />
        ) : (
          <FormSelectRow
            disabled={pending}
            label={t('recurring.editor.category')}
            onChange={(value) => setCategoryKey(value === 0 ? null : value)}
            options={categoryOptions}
            placeholder={t('recurring.editor.noCategory')}
            value={categoryKey ?? 0}
          />
        )}
      </FormGroup>
    </ScrollView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  overflow: { marginRight: -11, marginVertical: -6 },
  notices: { gap: themeTokens.spacing[2] },
  quiet: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] },
  summaryBlock: { gap: themeTokens.spacing[4] },
  lead: { gap: themeTokens.spacing[1] },
  leadLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[2], rowGap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  sectionNote: { marginTop: -themeTokens.spacing[2] },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2], marginTop: themeTokens.spacing[3] },
  facts: { flexDirection: 'row', gap: themeTokens.spacing[4], marginTop: themeTokens.spacing[3] },
  fact: { flex: 1, gap: 2 },
  emptyLine: { paddingVertical: themeTokens.spacing[4] },
  timelineRow: { flexDirection: 'row', gap: themeTokens.spacing[4] },
  rail: { alignItems: 'center', paddingTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  railLine: { width: 1, flex: 1, minHeight: 32, marginTop: themeTokens.spacing[2] },
  timelineBody: { flex: 1, gap: themeTokens.spacing[1], paddingBottom: themeTokens.spacing[4] },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  shrink: { flexShrink: 1 },
  impact: { gap: themeTokens.spacing[4] },
  impactRow: { gap: themeTokens.spacing[2] },
  track: { height: 8, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.pill },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, justifyContent: 'center', padding: themeTokens.spacing[6] },
  dialog: { width: '100%', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[6], gap: themeTokens.spacing[3] },
  dialogActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[2], marginTop: themeTokens.spacing[2] },
  editor: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
})

import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import type { Href } from 'expo-router'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EntityMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { List, ListRow } from '@/components/ui/list-row'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { ObjectHeader, PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Divider } from '@/components/ui/section'
import { StatCell, StatColumns } from '@/components/ui/stat'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { LoanOverviewDto } from './loans-contract'
import type { LoanViewModel } from './loans-view-model'

export type LoansViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; loans: readonly LoanViewModel[]; refreshing?: boolean }
  | { status: 'refresh-error'; loans: readonly LoanViewModel[]; refreshing?: boolean }

/**
 * Web's Loans page (`loans/loans-client.tsx`) at phone width, in the calm structure: title and
 * description; Outstanding debt, Monthly repayments, Interest & fees and Net worth impact as a
 * stat list; then the loans. Web draws them as a sideways-scrolling table; here each loan is a
 * flat row led by its mark, carrying the same columns (loan and type, outstanding principal,
 * progress, next payment and rate). Adding a loan is the floating "+".
 */
export function LoansScreen({ state, overview = null, onOpenLoan, onRefresh, onCreateLoan }: {
  state: LoansViewState
  /** The API's totals; `null` while unavailable, in which case no total is shown. */
  overview?: LoanOverviewDto | null
  onOpenLoan: (loanId: number) => void
  onRefresh: () => void | Promise<void>
  /** Kept for the route's signature; the Loans page is top level and has no back link. */
  onBack?: () => void
  onCreateLoan: () => void
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('loans.loading')} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    return <Failure title={t(state.status === 'invalid-response' ? 'loans.invalidTitle' : 'loans.errorTitle')} message={t(state.status === 'invalid-response' ? 'loans.invalidMessage' : 'loans.errorMessage')} onRetry={onRefresh} />
  }
  const empty = state.loans.length === 0
  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, !empty && styles.contentUnderButton]} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          {state.status === 'refresh-error' ? <Alert label={t('loans.stale')} palette={palette} /> : null}
          {empty ? (
            <View style={styles.empty}>
              <View style={styles.emptyCopy}>
                <Text accessibilityRole="header" variant="section">{t('loans.emptyTitle')}</Text>
                <Text tone="muted" variant="meta">{t('loans.emptyMessage')}</Text>
              </View>
              <LoanPreview locale={locale} currency={overview?.currency ?? 'EUR'} />
              <Button icon="plus" label={t('loans.add')} onPress={onCreateLoan} style={styles.hug} />
            </View>
          ) : (
            <>
              <PageHeader title={t('loans.title')} description={t('loans.description')} />
              {overview ? <LoansSummary overview={overview} locale={locale} /> : null}
              <List>
                {state.loans.map((loan, index) => <LoanRow key={loan.id} loan={loan} locale={locale} onPress={() => onOpenLoan(loan.id)} separated={index > 0} />)}
              </List>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
    {/* The empty state's own "Add loan" is the one add there. */}
    {!empty ? <FloatingActionButton accessibilityLabel={t('loans.add')} onPress={onCreateLoan} testID="loans-add" /> : null}
    </View>
  )
}

/** Web `LoansSummaryCards`, in the API's single currency. */
function LoansSummary({ overview, locale }: { overview: LoanOverviewDto; locale: string }) {
  const { t } = useTranslation()
  const currency = overview.currency ?? null
  const outstanding = overview.totalOutstandingAmount ?? overview.totalOutstandingDebt
  // One headline (the debt still owed), then the month's figures as columns.
  return (
    <View style={styles.summary} testID="loans-summary">
      <HeadlineFigure currency={currency} label={t('loans.summary.outstandingDebt')} locale={locale} value={outstanding} />
      <StatColumns>
        <StatCell key="monthly" currency={currency} label={t('loans.summary.monthlyRepayments')} locale={locale} value={overview.monthlyRepaymentTotal} />
        <StatCell key="interest" currency={currency} label={t('loans.summary.interestFees')} locale={locale} value={overview.interestFeesThisMonth} />
        <StatCell key="impact" currency={currency} label={t('loans.summary.netWorthImpact')} locale={locale} value={overview.netWorthImpact} />
        {overview.repaymentsNeedingReviewCount > 0 ? (
          <StatCell key="review" label={t('loans.summary.needReview')} locale={locale}>{String(overview.repaymentsNeedingReviewCount)}</StatCell>
        ) : null}
      </StatColumns>
    </View>
  )
}

function formatRate(percent: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(percent / 100)
}

/** One loan: web's Loan, Outstanding principal, Progress, Next payment and Rate columns. */
function LoanRow({ loan, locale, onPress, separated }: { loan: LoanViewModel; locale: string; onPress: () => void; separated: boolean }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const money = (value: number) => formatMoney(value, { locale, currency: loan.currencyCode })
  const payment = loan.regularPayment === null ? t('loans.paymentUnavailable') : t('loans.paymentValue', { value: money(loan.regularPayment), frequency: t(`loans.frequency.${loan.paymentFrequency}`) })
  const next = loan.nextPaymentDate ? formatDate(loan.nextPaymentDate, locale) : null
  const descriptor = [t(`loans.type.${loan.type}`), loan.providerName].filter(Boolean).join(', ')
  const repaid = t('loans.progressRepaid', { value: Math.round(loan.meterPercentage) })
  const nextLine = [next ? `${t('loans.nextPayment')} ${next}` : loan.paymentDay ? t('loans.paymentDayValue', { day: loan.paymentDay }) : null, loan.annualRatePercent !== null ? `${t('loans.rate')} ${formatRate(loan.annualRatePercent, locale)}` : null].filter(Boolean).join(' · ')
  const label = [loan.name, descriptor, t(`loans.status.${loan.status}`), `${t('loans.outstanding')}, ${money(loan.outstanding)}, ${loan.currencyCode}`, repaid, payment, nextLine].filter(Boolean).join(', ')
  return (
    <ListRow
      accessibilityLabel={label}
      badge={loan.status !== 'ACTIVE' ? <Badge label={t(`loans.status.${loan.status}`)} tone="muted" /> : undefined}
      density="comfortable"
      figure={<Amount currency={loan.currencyCode} locale={locale} size="amountBase" value={loan.outstanding} />}
      figureMeta={<Text tone="muted" variant="meta">{t('loans.outstanding')}</Text>}
      leading={<EntityMark glyph="receipt-text" />}
      meta={[descriptor]}
      onPress={onPress}
      separated={separated}
      title={loan.name}
    >
      <View style={styles.rowExtra}>
        <LoanProgress value={loan.meterPercentage} label={repaid} />
        <Text tone="muted" variant="meta">{payment}{nextLine ? ` · ${nextLine}` : ''}</Text>
      </View>
    </ListRow>
  )
}

/** Web `LoanProgressIndicator`: an 8pt bar with "N% repaid" beside it. */
export function LoanProgress({ value, label, testID }: { value: number; label: string; testID?: string }) {
  const palette = usePalette()
  const width = Math.max(0, Math.min(100, value))
  return (
    <View style={styles.progress}>
      <ProgressBar color={palette.primary} testID={testID} track="border" style={styles.track} value={width} />
      <Text style={styles.progressLabel} tone="muted" variant="label">{label}</Text>
    </View>
  )
}

/** Web's empty-state preview: a sample loan on a background step (No-Nesting rule). */
function LoanPreview({ locale, currency }: { locale: string; currency: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <View style={[styles.preview, { backgroundColor: palette.muted }]}>
      <View style={styles.previewHeading}>
        <PreviewLabel />
        <Text tone="muted" variant="meta">{t('loans.previewSubtitle')}</Text>
      </View>
      <Divider />
      <View style={styles.previewTop}>
        <View>
          <Text variant="metaStrong">{t('loans.type.MORTGAGE')}</Text>
          <Text tone="muted" variant="meta">{t('loans.previewProvider')}</Text>
        </View>
        <Text tone="muted" variant="meta">{t('loans.status.ACTIVE')}</Text>
      </View>
      <View style={styles.previewMetrics}>
        <View style={[styles.previewMetric, { backgroundColor: palette.background }]}>
          <Text tone="muted" variant="meta">{t('loans.outstanding')}</Text>
          <Text variant="amount">{formatMoney(0, { locale, currency })}</Text>
        </View>
        <View style={[styles.previewMetric, { backgroundColor: palette.background }]}>
          <Text tone="muted" variant="meta">{t('loans.remainingTerm')}</Text>
          <Text variant="amount">{t('loans.previewTermValue')}</Text>
        </View>
      </View>
    </View>
  )
}

export function formatDate(value: string, locale: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed)
}

/**
 * Back on its own row, the title below it. `descriptor` is the object's own data (a loan's
 * provider), never a sentence explaining the screen. `leading` is the object's mark and `action`
 * the title row's one glyph.
 */
export function Header({ title, descriptor, fallback, backLabel, onBack, badge, figure, leading, action }: { title: string; descriptor?: string; fallback: Href; backLabel: string; onBack: () => void; badge?: React.ReactNode; figure?: React.ReactNode; leading?: React.ReactNode; action?: React.ReactNode }) {
  return <View style={styles.header}><BackControl fallback={fallback} label={backLabel} onPress={onBack} />{descriptor || figure || badge || leading ? <ObjectHeader action={action} badge={badge} descriptor={descriptor} figure={figure} leading={leading} title={title} /> : <PageHeader action={action} title={title} />}</View>
}

export function Alert({ label }: { label: string; palette?: Palette }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="alert" style={[styles.alert, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <Text variant="meta">{label}</Text>
    </View>
  )
}

export function Loading({ label }: { label: string; palette?: Palette }) {
  const palette = usePalette()
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>{[160, 320, 320].map((width, index) => <View key={index} style={[styles.skeleton, { width, maxWidth: '100%', backgroundColor: palette.muted }]} />)}</View></SafeAreaView>
}

export function Failure({ title, message, onRetry, onBack, fallback, backLabel }: { title: string; message: string; onRetry?: () => void | Promise<void>; onBack?: () => void; fallback?: Href; backLabel?: string; palette?: Palette }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          {fallback && onBack ? <BackControl fallback={fallback} label={backLabel} onPress={onBack} /> : null}
          <Card density="standalone">
            <View style={styles.emptyCopy}>
              <Text accessibilityRole="header" variant="section">{title}</Text>
              <Text tone="muted" variant="meta">{message}</Text>
              {onRetry ? <Button label={t('common.retry')} onPress={onRetry} style={styles.hug} /> : null}
            </View>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  header: { gap: themeTokens.spacing[4] },
  summary: { gap: themeTokens.spacing[6] },
  hug: { alignSelf: 'flex-start' },
  rowExtra: { gap: themeTokens.spacing[2], paddingTop: themeTokens.spacing[2] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  track: { flex: 1, height: 8, borderRadius: themeTokens.radius.sm, overflow: 'hidden' },
  progressLabel: { minWidth: 64, textAlign: 'right' },
  empty: { gap: themeTokens.spacing[4] },
  emptyCopy: { gap: themeTokens.spacing[2] },
  preview: { borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  previewHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[3] },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: themeTokens.spacing[3] },
  previewMetrics: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  previewMetric: { flex: 1, gap: themeTokens.spacing[1], borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
  alert: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[3] },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  skeleton: { height: 64, borderRadius: themeTokens.radius.lg },
})

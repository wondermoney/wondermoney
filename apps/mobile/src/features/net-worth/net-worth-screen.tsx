import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import {
  defaultDashboardLayout,
  type DashboardLayoutEntry,
  type DashboardSectionId,
} from '@wondermoney/shared/dashboard-layout'

import { Amount } from '@/components/ui/amount'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { DataProvenance } from '@/components/ui/data-provenance'
import type { EntityMarkSource } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { IconButton } from '@/components/ui/icon-button'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Text } from '@/components/ui/text'
import { formatCurrencyList } from '@/components/ui/unconverted-amounts-note'
import { useMoneyLabel } from '@/lib/formatters/money-display'
import { formatRelativeTime } from '@/lib/formatters/relative-time'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { PrivacyToggle } from '@/features/preferences/privacy-toggle'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { BankAlertBannerModel } from '@/features/banking/bank-alerts-view-model'
import type { HouseholdMembersModel, MemberFilter } from '@/features/household/member-attribution'
import { MemberFilterButton } from '@/features/household/member-filter-control'

import { BankAlertBanner } from './bank-alert-banner'
import {
  BalanceSheetSection,
  type BudgetMonthRow,
  CashflowSection,
  InsightsSection,
  type InsightsState,
  LatestTransactionsSection,
  LoansSection,
  SectionEmpty,
  SectionError,
  SetupChecklist,
  ThisMonthSection,
  type SectionState,
  type SetupSteps,
} from './home-sections'
import { balanceSheet, formatMonthName, netWorthChanges, type CashflowView, type NetWorthChange, type ResolvedHistoryPoint } from './home-model'
import type { NetWorthRowDto } from './net-worth-contract'
import { NetWorthChart } from './net-worth-chart'
import { PortfolioLinkSuggestion, type PortfolioLinkSaveResult, type PortfolioLinkSuggestionModel } from './portfolio-link-suggestion'
import type { PortfolioAccountLinkInput } from '@/features/portfolios/portfolio-account-link'
import type { LoanDto } from '@/features/loans/loans-contract'
import type { TransactionDto, TransactionReviewSummaryDto } from '@/features/transactions/transactions-contract'

export type NetWorthData = {
  primaryCurrency: string
  total: number
  rows: readonly NetWorthRowDto[]
  completeness: 'partial' | 'unknown'
  /** Accounts left out for want of an exchange rate; absent from older APIs. */
  unsupportedAccountCount?: number
  unsupportedLoanCount: number
  unsupportedPortfolioCount: number
  /** Manually valued assets left out for want of a rate; absent from older APIs. */
  unsupportedManualAssetCount?: number
  /** The currencies of the accounts, loans and manual assets left out, named under the total. */
  unconvertedCurrencies?: readonly string[]
}

export type NetWorthViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'loaded'; data: NetWorthData; refreshing?: boolean }
  | { status: 'refresh-error'; data: NetWorthData; refreshing?: boolean }

export type InsightState =
  | { status: 'hidden' }
  | SectionState<{ name: string; amount: number; currency: string | null }>

export type HomeSections = {
  /** Month-closing net worth, resolved points only. */
  history: SectionState<readonly ResolvedHistoryPoint[]>
  /** How long ago the oldest synced balance refreshed; null hides the line. */
  /** The oldest sync among the connected accounts; null when none syncs. */
  freshness: Date | null
  /** null while its inputs load, or once dismissed. */
  setup: SetupSteps | null
  /** The bank connection alerts not yet dismissed; null or absent shows nothing. */
  bankAlert?: BankAlertBannerModel | null
  month: SectionState<readonly BudgetMonthRow[]>
  cashflow: SectionState<CashflowView>
  loans: SectionState<{ upcoming: readonly LoanDto[]; hasLoans: boolean }>
  latest: SectionState<{ review: TransactionReviewSummaryDto | null; transactions: readonly TransactionDto[] }>
  /** Deterministic insights, with "Spent most on" as the fallback when none fires. */
  insights: InsightsState
  /** The "Spent most on" fallback's own query. */
  insight: InsightState
  /** Each account's mark for the balance sheet, by account key; absent until the accounts load. */
  accountMarks?: ReadonlyMap<number, EntityMarkSource>
  portfolioMarks?: ReadonlyMap<number, EntityMarkSource>
  /** "Is this the same money?": what it offers to link, or null/absent when it does not show. */
  portfolioLink?: PortfolioLinkSuggestionModel | null
}

export type NetWorthScreenProps = {
  state: NetWorthViewState
  sections: HomeSections
  today: Date
  /** The home's section order and visibility; defaults to the shipped order. */
  layout?: readonly DashboardLayoutEntry[]
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onViewHistory: () => void
  onNavigate: (href: string) => void
  onRetryHistory: () => void
  onRetryBudgets: () => void
  onRetryCashflow: () => void
  onRetryLoans: () => void
  onRetryLatest: () => void
  onDismissSetup: () => void
  onDismissBankAlert?: () => void
  onDismissPortfolioLink?: () => void
  onLinkPortfolio?: (portfolioId: number, accountLink: PortfolioAccountLinkInput) => Promise<PortfolioLinkSaveResult>
  /** Opens "Customize home"; omitted where the affordance should not show. */
  onCustomize?: () => void
  /** Whose home this is: everyone, one member or Shared. Omitted (a household of one), not shown. */
  memberFilter?: Readonly<{ model: HouseholdMembersModel; value: MemberFilter; onChange: (value: MemberFilter) => void }>
}

/**
 * Home, as web's `HomeOverview` at phone width: net worth leads (the figure,
 * its change since last month and over the history, what is owned and owed,
 * the month-closing trend), then any bank connection alert, the setup checklist,
 * and the remaining sections in the person's saved order — this month's budgets,
 * the balance sheet, net cash flow, the next loan payments and the latest
 * transactions. Every section loads on its own, so one failed request costs
 * one section, not the page.
 */
export function NetWorthScreen(props: NetWorthScreenProps) {
  const { state, sections, today, onRefresh, layout = defaultDashboardLayout(), onCustomize, memberFilter } = props
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // The spinner belongs to the pull gesture, not to every background refetch:
  // on iOS a RefreshControl that mounts with `refreshing` true sticks at the
  // top and pushes the content down.
  const [pulling, setPulling] = useState(false)
  const pullToRefresh = useCallback(async () => {
    setPulling(true)
    try {
      await onRefresh()
    } finally {
      setPulling(false)
    }
  }, [onRefresh])

  const loaded = state.status === 'loaded' || state.status === 'refresh-error' ? state.data : null
  const currency = loaded?.primaryCurrency ?? 'EUR'
  const sheet = loaded ? balanceSheet(loaded.rows) : null
  const hasSheet = sheet !== null && (sheet.own.length > 0 || sheet.owe.length > 0)

  // One node per configurable section; the layout decides which render, and in
  // what order. Net worth is rendered above, pinned first.
  const sectionNodes: Record<Exclude<DashboardSectionId, 'net-worth'>, ReactNode> = {
    insights: <InsightsSection fallbackCurrency={currency} locale={locale} onNavigate={props.onNavigate} state={sections.insights} />,
    'this-month': <ThisMonthSection locale={locale} onNavigate={props.onNavigate} onRetry={props.onRetryBudgets} state={sections.month} today={today} />,
    'balance-sheet': sheet && hasSheet ? (
      <BalanceSheetSection
        accountMarks={sections.accountMarks}
        currency={currency}
        locale={locale}
        notice={sections.portfolioLink && props.onLinkPortfolio ? (
          <PortfolioLinkSuggestion model={sections.portfolioLink} onDismiss={() => props.onDismissPortfolioLink?.()} onSave={props.onLinkPortfolio} />
        ) : null}
        portfolioMarks={sections.portfolioMarks}
        sheet={sheet}
      />
    ) : null,
    cashflow: <CashflowSection currency={currency} locale={locale} onRetry={props.onRetryCashflow} state={sections.cashflow} today={today} />,
    loans: <LoansSection locale={locale} onNavigate={props.onNavigate} onRetry={props.onRetryLoans} state={sections.loans} />,
    'latest-transactions': <LatestTransactionsSection locale={locale} onNavigate={props.onNavigate} onRetry={props.onRetryLatest} state={sections.latest} />,
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={() => void pullToRefresh()} refreshing={pulling} tintColor={palette.primary} />}
      >
        <View style={styles.page}>
          <View style={styles.lead}>
            <PageHeader
              action={(
                <View style={styles.headerActions}>
                  {onCustomize ? (
                    <IconButton
                      accessibilityLabel={t('home.customize.action')}
                      icon="sliders-horizontal"
                      onPress={onCustomize}
                      testID="home-customize"
                    />
                  ) : null}
                  <PrivacyToggle />
                </View>
              )}
              title={t('navigation.home')}
            />
            {memberFilter ? (
              <View style={styles.memberFilter}>
                <MemberFilterButton model={memberFilter.model} onChange={memberFilter.onChange} value={memberFilter.value} />
              </View>
            ) : null}
            <NetWorthHero {...props} locale={locale} />
          </View>

          {sections.bankAlert ? (
            <BankAlertBanner locale={locale} model={sections.bankAlert} onDismiss={() => props.onDismissBankAlert?.()} onNavigate={props.onNavigate} />
          ) : null}

          {sections.setup ? <SetupChecklist onDismiss={props.onDismissSetup} onNavigate={props.onNavigate} steps={sections.setup} /> : null}

          {layout
            .filter((entry) => entry.id !== 'net-worth' && !entry.hidden)
            .map((entry) => (
              <View key={entry.id}>{sectionNodes[entry.id as Exclude<DashboardSectionId, 'net-worth'>]}</View>
            ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function NetWorthHero({ state, sections, today, locale, onRefresh, onLogout, onViewHistory, onNavigate, onRetryHistory }: NetWorthScreenProps & { locale: string }) {
  // Every figure formatted here is an accessibility reading; the visible ones are `Amount`s.
  const moneyLabel = useMoneyLabel()
  const { hidden } = usePrivacyMode()
  const { t } = useTranslation()
  const palette = usePalette()
  const title = t('home.netWorth.title')
  const [range, setRange] = useState<ChartRange>('1y')
  const freshness = formatRelativeTime(sections.freshness, t)
  // The status line: the figure's name, then a dot and how fresh it is.
  const status = freshness ? { label: t('home.balancesUpdated', { time: freshness }) } : undefined
  const historyPoints = sections.history.status === 'loaded' ? sections.history.data : null
  const ranged = useMemo(() => (historyPoints ? pointsInRange(historyPoints, range) : []), [historyPoints, range])

  const header = (
    <View style={styles.heroHeader}>
      <Text accessibilityRole="header" style={styles.shrink} variant="subheading">{title}</Text>
      {/* Web AccountsFreshness: plain muted text, no glyph. */}
      <DataProvenance icon={false} label={(time) => t('home.balancesUpdated', { time })} updatedAt={sections.freshness} />
    </View>
  )

  if (state.status === 'loading') {
    return (
      <View style={styles.hero}>
        {header}
        <View accessible accessibilityLabel={t('netWorth.loading')} accessibilityRole="progressbar" style={styles.heroSkeleton}>
          {[{ width: 288, height: 64 }, { width: 256, height: 20 }, { width: 320, height: 48 }, { width: '100%' as const, height: 176 }].map((size, index) => (
            <View key={index} style={[styles.skeleton, { width: size.width, height: size.height, backgroundColor: palette.muted }]} />
          ))}
        </View>
      </View>
    )
  }

  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <View style={styles.hero}>
        {header}
        <SectionError
          message={invalid ? t('netWorth.invalidMessage') : t('netWorth.errorMessage')}
          onRetry={() => void onRefresh()}
        />
        <View style={styles.heroErrorActions}>
          <Button label={t('common.signOut')} onPress={onLogout} variant="ghost" />
        </View>
      </View>
    )
  }

  const data = state.data
  if ((data.rows?.length ?? 0) === 0 && data.total === 0) {
    return (
      <View style={styles.hero}>
        {header}
        <SectionEmpty
          action={<Button label={t('home.netWorth.emptyAction')} onPress={() => onNavigate('/accounts')} />}
          body={t('home.netWorth.emptyBody')}
          title={t('home.netWorth.emptyTitle')}
        />
      </View>
    )
  }

  const sheet = balanceSheet(data.rows)
  const points = sections.history.status === 'loaded' ? sections.history.data : []
  const changes = netWorthChanges(points, data.total, today)
  const sinceLabel = (change: NetWorthChange) => {
    const since = new Date(`${change.since.slice(0, 10)}T00:00:00.000Z`)
    return t('home.netWorth.since', {
      month: formatMonthName(since, locale, { utc: true, withYear: since.getUTCFullYear() !== today.getFullYear() }),
    })
  }
  const deltas = [changes.lastMonth, changes.overHistory]
    .filter((change): change is NetWorthChange => change !== null)
    .map((change) => ({ value: change.delta, label: sinceLabel(change) }))
  const formattedTotal = moneyLabel(data.total, { locale, currency: data.primaryCurrency })
  const deltaReadings = deltas
    .filter((delta) => delta.value !== 0)
    .map((delta) => `${delta.value > 0 && !hidden ? '+' : ''}${moneyLabel(delta.value, { locale, currency: data.primaryCurrency })} ${delta.label}`)

  return (
    <View style={styles.hero} testID="home-net-worth">
      {state.status === 'refresh-error' ? (
        <Banner
          action={<Button label={t('common.retry')} onPress={onRefresh} size="sm" variant="secondary" />}
          message={t('netWorth.stale')}
          testID="net-worth-stale"
          tone="destructive"
        />
      ) : null}
      <View style={styles.figureBlock}>
        {/* One reading for the figure and its changes; the deltas' colour never carries the sign alone. */}
        <HeadlineFigure
          accessibilityLabel={[`${title}, ${formattedTotal}, ${data.primaryCurrency}`, ...deltaReadings].join(', ')}
          currency={data.primaryCurrency}
          deltaSize="amountBase"
          deltas={deltas}
          label={title}
          labelIsHeader
          locale={locale}
          status={status}
          testID="net-worth-total"
          value={data.total}
        />
        {data.completeness === 'partial' ? <Text tone="warning" variant="meta">{t('netWorth.completeness.partial')}</Text> : null}
        {(data.unsupportedAccountCount ?? 0) > 0 ? (
          <Text accessibilityRole="alert" tone="muted" variant="meta">{t('netWorth.unsupportedAccount', { count: data.unsupportedAccountCount })}</Text>
        ) : null}
        {data.unsupportedLoanCount > 0 ? (
          <Text accessibilityRole="alert" tone="muted" variant="meta">{t('netWorth.unsupportedLoan', { count: data.unsupportedLoanCount })}</Text>
        ) : null}
        {data.unsupportedPortfolioCount > 0 ? (
          <Text accessibilityRole="alert" tone="muted" variant="meta">{t('netWorth.unsupportedPortfolio', { count: data.unsupportedPortfolioCount })}</Text>
        ) : null}
        {(data.unsupportedManualAssetCount ?? 0) > 0 ? (
          <Text accessibilityRole="alert" tone="muted" variant="meta">{t('netWorth.unsupportedManualAsset', { count: data.unsupportedManualAssetCount })}</Text>
        ) : null}
        {data.unconvertedCurrencies && data.unconvertedCurrencies.length > 0 ? (
          <Text tone="muted" variant="meta" testID="net-worth-unconverted-currencies">{t('netWorth.unconvertedCurrencies', { currencies: formatCurrencyList(data.unconvertedCurrencies, locale) })}</Text>
        ) : null}
        <View style={styles.ownOwe}>
          <View accessible accessibilityLabel={`${t('home.sheet.own')}, ${moneyLabel(sheet.ownTotal, { locale, currency: data.primaryCurrency })}`} style={styles.ownOweItem}>
            <Text tone="muted" variant="meta">{t('home.sheet.own')}</Text>
            <Amount currency={data.primaryCurrency} locale={locale} size="amountLarge" value={sheet.ownTotal} />
          </View>
          <View accessible accessibilityLabel={`${t('home.sheet.owe')}, ${moneyLabel(sheet.oweTotal, { locale, currency: data.primaryCurrency })}`} style={styles.ownOweItem}>
            <Text tone="muted" variant="meta">{t('home.sheet.owe')}</Text>
            <Amount currency={data.primaryCurrency} locale={locale} size="amountLarge" value={sheet.oweTotal} />
          </View>
        </View>
      </View>

      {sections.history.status === 'loading' ? (
        <View style={[styles.skeleton, { height: 176, backgroundColor: palette.muted }]} />
      ) : sections.history.status === 'error' ? (
        <View style={styles.historyError}>
          <Text tone="muted" variant="meta">{t('home.netWorth.historyError')}</Text>
          <Button label={t('home.tryAgain')} onPress={onRetryHistory} size="sm" variant="secondary" />
        </View>
      ) : ranged.length >= 2 ? (
        <View style={styles.chartBlock}>
          <NetWorthChart
            accessibilityLabel={t('home.netWorth.chartLabel', {
              from: formatMonthName(new Date(`${ranged[0].date.slice(0, 10)}T00:00:00.000Z`), locale, { utc: true, withYear: true }),
              to: formatMonthName(new Date(`${ranged[ranged.length - 1].date.slice(0, 10)}T00:00:00.000Z`), locale, { utc: true, withYear: true }),
            })}
            currency={data.primaryCurrency}
            locale={locale}
            points={ranged}
          />
          {/* Only the ranges the history endpoint covers: monthly closes, at most twelve months. */}
          {points.length > CHART_RANGES[0].months + 1 ? (
            <SegmentedControl
              accessibilityLabel={t('home.netWorth.rangeLabel')}
              fill
              onChange={setRange}
              options={CHART_RANGES.map((item) => ({ value: item.value, label: t(`home.netWorth.ranges.${item.value}`) }))}
              size="sm"
              testID="net-worth-range"
              value={range}
            />
          ) : null}
        </View>
      ) : null}

      {/* Web has no page behind the chart; mobile keeps its month-by-month table one tap away. */}
      <View style={styles.trendLink}>
        <Button label={t('netWorth.viewTrend')} onPress={onViewHistory} trailingIcon="chevron-right" variant="link" />
      </View>
    </View>
  )
}

type ChartRange = '3m' | '6m' | '1y'
const CHART_RANGES: readonly { value: ChartRange; months: number }[] = [
  { value: '3m', months: 3 },
  { value: '6m', months: 6 },
  { value: '1y', months: 12 },
]

/**
 * The month-closing points a range shows: the close that opens it and every
 * point after (3M is four points: the close three months back, then each
 * month to today). Sliced from the twelve months Home already loads.
 */
function pointsInRange(points: readonly ResolvedHistoryPoint[], range: ChartRange): readonly ResolvedHistoryPoint[] {
  const months = CHART_RANGES.find((item) => item.value === range)?.months ?? 12
  return points.length > months + 1 ? points.slice(points.length - (months + 1)) : points
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  // The member filter sits under the title, at the start of the row, sized to its label.
  memberFilter: { flexDirection: 'row' },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  // Space, not rules, between Home's sections: 40pt and a strong heading.
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  lead: { gap: themeTokens.spacing[6] },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1] },
  chartBlock: { gap: themeTokens.spacing[3] },
  hero: { gap: themeTokens.spacing[4] },
  heroHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: themeTokens.spacing[8], rowGap: themeTokens.spacing[2] },
  shrink: { flexShrink: 1 },
  figureBlock: { gap: themeTokens.spacing[2], marginBottom: themeTokens.spacing[4] },
  // You own / You owe as two equal columns.
  ownOwe: { flexDirection: 'row', gap: themeTokens.spacing[4], marginTop: themeTokens.spacing[4] },
  ownOweItem: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
  historyError: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[4], rowGap: themeTokens.spacing[2] },
  trendLink: { alignItems: 'flex-start' },
  heroSkeleton: { gap: themeTokens.spacing[4] },
  heroErrorActions: { alignItems: 'flex-start' },
  skeleton: { maxWidth: '100%', borderRadius: themeTokens.radius.md },
})

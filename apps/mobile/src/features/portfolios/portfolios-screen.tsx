import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { SelectTrigger } from '@/components/ui/select-trigger'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatPercentagePoints } from '@/lib/formatters/financial'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { PortfolioPerformanceChart, type PortfolioPerformanceChartProps, type PortfolioPerformanceState } from './portfolio-performance-chart'
import { Metric, PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import {
  DividendIncomeBody,
  hasDividendIncome,
  type DividendIncomeData,
  HoldingsList,
  PortfolioAllocationSection,
  PortfolioBreakdownSection,
  PortfolioMetricsSection,
  PortfolioSummaryStats,
  PortfolioTopMoversSection,
  SectionStatus,
} from './portfolio-sections'
import { PORTFOLIO_PERFORMANCE_PERIODS, type PortfolioAllocationDto, type PortfolioMetricsDto, type PortfolioPerformancePeriod, type PortfolioTopMoversDto } from './portfolios-contract'
import type { HoldingViewModel, PortfolioOverviewViewModel } from './portfolios-view-model'
import type { PortfolioResourceState } from './use-portfolio-resource'

export type PortfoliosViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: PortfolioOverviewViewModel; refreshing?: boolean }
  | { status: 'refresh-error'; data: PortfolioOverviewViewModel; refreshing?: boolean }

/** The sections below the summary, each loading on its own (web fetches them in parallel). */
export type PortfolioOverviewSections = Readonly<{
  metrics: PortfolioResourceState<PortfolioMetricsDto>
  performance: PortfolioPerformanceState
  allocation: PortfolioResourceState<PortfolioAllocationDto>
  topMovers: PortfolioResourceState<PortfolioTopMoversDto>
  dividends: PortfolioResourceState<DividendIncomeData>
  holdings: PortfolioResourceState<readonly HoldingViewModel[]>
}>

const idleSections: PortfolioOverviewSections = {
  metrics: { status: 'loading' },
  performance: { status: 'loading' },
  allocation: { status: 'loading' },
  topMovers: { status: 'loading' },
  dividends: { status: 'loading' },
  holdings: { status: 'loading' },
}

export type PortfoliosScreenProps = {
  state: PortfoliosViewState
  sections?: PortfolioOverviewSections
  period?: PortfolioPerformancePeriod
  onSelectPeriod?: (period: PortfolioPerformancePeriod) => void
  onCreatePortfolio?: () => void
  /** Opens the add-transaction flow for the chosen portfolio (web's modal asks which one). */
  onAddTransaction?: (portfolioId: number) => void
  onOpenHolding?: (holding: HoldingViewModel) => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onSelectPortfolio: (id: number) => void
  /** The Performance chart's member filter; the tab's other figures stay the household's. */
  performanceMemberFilter?: PortfolioPerformanceChartProps['memberFilter']
}

const previewHoldings = [
  { symbol: 'AAPL', allocation: 35 },
  { symbol: 'MSFT', allocation: 28 },
  { symbol: 'VWCE', allocation: 22 },
  { symbol: 'GOOGL', allocation: 15 },
] as const

/**
 * Web's Portfolios overview (`app/[locale]/(full-layout)/portfolio/page.tsx`), laid out for a
 * phone: the title with its help glyph, one control row with the period select, the total
 * value as the headline figure and the other summary figures beneath, and a floating "+" (a
 * sheet offering Add transaction and Create portfolio). Then Portfolio Breakdown (the
 * portfolios), Performance, Allocation, Advanced metrics, Top Movers, Dividend Income (when
 * there is any) and All Holdings — each an open section.
 * Web's Benchmark Comparison and Calendar are not built here.
 */
export function PortfoliosScreen({ state, sections = idleSections, period = 'YTD', onSelectPeriod = () => undefined, onCreatePortfolio = () => undefined, onAddTransaction = () => undefined, onOpenHolding = () => undefined, onRefresh, onLogout, onSelectPortfolio, performanceMemberFilter }: PortfoliosScreenProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [picker, setPicker] = useState<'period' | 'add' | null>(null)
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('portfolios.loading')} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return <PortfolioFailure title={t(invalid ? 'portfolios.invalidTitle' : 'portfolios.errorTitle')} message={t(invalid ? 'portfolios.invalidMessage' : 'portfolios.errorMessage')} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} onRetry={onRefresh} onSignOut={onLogout} palette={palette} />
  }

  const { data } = state
  const refresh = <RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />

  if (data.portfolioCount === 0) {
    const money = (value: number) => formatMoney(value, { locale, currency: data.currency })
    const percent = (value: number) => formatPercentagePoints(value, locale, { maximumFractionDigits: 1 })
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
          <View style={styles.page}>
            <PageHeader title={t('portfolios.title')} helpText={t('portfolios.helpHint')} helpLabel={false} />
            <Card density="standalone" style={styles.empty}>
              <View style={styles.emptyHeader}>
                <View style={styles.emptyCopy}>
                  <Text variant="subheading">{t('portfolios.emptyTitle')}</Text>
                  <Text tone="muted" variant="meta">{t('portfolios.empty')}</Text>
                </View>
                <PreviewLabel />
              </View>
              {/* Background-step, not a second border — the card already has one (No-Nesting rule). */}
              <View style={[styles.preview, { backgroundColor: palette.muted }]}>
                <Text tone="muted" variant="meta">{t('portfolios.previewValue')}</Text>
                <Text variant="figure">{money(24680.5)}</Text>
                <View style={styles.previewMetrics}>
                  <Metric label={t('portfolios.gainLoss')} value={money(1840)} palette={palette} tone="positive" />
                  <Metric label={t('portfolios.ytdReturn')} value={percent(12.4)} palette={palette} tone="positive" />
                </View>
                <Text tone="muted" variant="meta">{t('portfolios.previewAllocation')}</Text>
                <View accessibilityLabel={t('portfolios.previewAllocation')} style={styles.allocationBar}>
                  {previewHoldings.map((holding) => <View key={holding.symbol} style={[styles.allocationSegment, { flex: holding.allocation, backgroundColor: palette.primary }]} />)}
                </View>
                <View style={styles.previewRows}>{previewHoldings.slice(0, 3).map((holding) => <View key={holding.symbol} style={styles.previewRow}><Text variant="metaStrong">{holding.symbol}</Text><Text tone="muted" variant="amount">{percent(holding.allocation)}</Text></View>)}</View>
              </View>
              <Button block icon="plus" label={t('portfolios.create')} onPress={onCreatePortfolio} variant="primary" />
            </Card>
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const periodOptions = PORTFOLIO_PERFORMANCE_PERIODS.map((value) => ({ value, label: t(`portfolios.periods.${value}`) }))
  // The one "+" lists both add actions. With several portfolios, "Add transaction" heads a
  // run of portfolio names, so the choice takes one sheet (a second sheet would open over
  // the first while it is still closing).
  const addGroups = [
    data.portfolios.length === 1
      ? { options: [{ value: `transaction:${data.portfolios[0]!.id}`, label: t('portfolios.addTransaction') }] }
      : { label: t('portfolios.addTransaction'), options: data.portfolios.map((portfolio) => ({ value: `transaction:${portfolio.id}`, label: portfolio.name })) },
    { options: [{ value: 'create', label: t('portfolios.create') }] },
  ]
  const chooseAdd = (value: string) => {
    if (value === 'create') onCreatePortfolio()
    else onAddTransaction(Number(value.slice('transaction:'.length)))
  }

  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, styles.contentUnderButton]} refreshControl={refresh}>
        <View style={styles.page}>
          <View style={styles.lead}>
            <PageHeader
              title={t('portfolios.title')}
              helpText={t('portfolios.helpHint')}
              helpLabel={false}
            />
            {state.status === 'refresh-error' ? <Text accessibilityRole="alert" style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]} variant="meta">{t('portfolios.stale')}</Text> : null}
            <PortfolioSummaryStats
              status={t('portfolioSections.portfolioCount', { count: data.portfolioCount })}
              figures={data}
              locale={locale}
              showRealized={false}
            />
            {/* The one control row, under the figures: the period the returns and the chart cover. */}
            <View style={styles.controlRow}>
              <SelectTrigger accessibilityLabel={t('portfolios.period')} onPress={() => setPicker('period')} size="sm" testID="portfolio-period" value={t(`portfolios.periods.${period}`)} />
            </View>
          </View>

          {/* The portfolios themselves come first, straight under the figures. */}
          <PortfolioBreakdownSection locale={locale} onSelect={onSelectPortfolio} portfolios={data.portfolios} />
          <PortfolioPerformanceChart currency={data.currency} memberFilter={performanceMemberFilter} palette={palette} period={period} state={sections.performance} />
          <PortfolioAllocationSection locale={locale} state={sections.allocation} title={t('portfolioSections.allocation')} />
          <PortfolioMetricsSection locale={locale} state={sections.metrics} />
          <PortfolioTopMoversSection currency={data.currency} locale={locale} state={sections.topMovers} />
          {sections.dividends.status === 'loaded' && hasDividendIncome(sections.dividends.data) ? (
            <Section title={t('portfolioSections.dividendIncome')} variant="open">
              <DividendIncomeBody data={sections.dividends.data} locale={locale} />
            </Section>
          ) : null}
          <Section title={t('portfolioSections.allHoldings')} variant="open" testID="portfolio-all-holdings">
            <SectionStatus state={sections.holdings}>
              {() => {
                const holdings = (sections.holdings as { data: readonly HoldingViewModel[] }).data
                return holdings.length === 0
                  ? <Text style={styles.centered} tone="muted" variant="meta">{t('portfolioSections.noHoldings')}</Text>
                  : <HoldingsList holdings={holdings} locale={locale} onOpen={onOpenHolding} />
              }}
            </SectionStatus>
          </Section>
        </View>
      </ScrollView>
      <OptionSheet onClose={() => setPicker(null)} onSelect={onSelectPeriod} options={periodOptions} title={t('portfolios.period')} value={period} visible={picker === 'period'} />
      <OptionSheet groups={addGroups} mode="menu" onClose={() => setPicker(null)} onSelect={chooseAdd} title={t('portfolios.add')} visible={picker === 'add'} />
    </SafeAreaView>
    {/* The one "+" lists both add actions (Add transaction, Create portfolio). */}
    <FloatingActionButton aboveTabBar accessibilityLabel={t('portfolios.add')} onPress={() => setPicker('add')} testID="portfolio-add" />
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  // Space, not rules, between the page's sections: 40pt and a 20/600 heading.
  page: { width: '100%', maxWidth: 800, alignSelf: 'center', gap: themeTokens.spacing[10] },
  // Title, the figures and the one control row sit tight; the sections keep 40pt between them.
  lead: { gap: themeTokens.spacing[6] },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  banner: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  centered: { paddingVertical: themeTokens.spacing[8], textAlign: 'center' },
  empty: { gap: themeTokens.spacing[4] },
  emptyHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  emptyCopy: { flex: 1, gap: themeTokens.spacing[2] },
  preview: { borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  previewMetrics: { flexDirection: 'row', gap: themeTokens.spacing[4] },
  allocationBar: { height: 8, flexDirection: 'row', overflow: 'hidden', borderRadius: themeTokens.radius.sm, gap: 1 },
  allocationSegment: { height: '100%' },
  previewRows: { gap: themeTokens.spacing[2] },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between' },
})

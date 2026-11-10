import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { formatPercentagePoints } from '@/lib/formatters/financial'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'

import type { PortfolioPerformanceReportViewModel, PortfolioPerformanceTotals } from './portfolio-performance-report-view-model'
import type { ReportDatePreset } from './report-date-presets'
import { ReportFiltersBar } from './report-filters-bar'
import {
  ReportEmptyState,
  ReportExportButton,
  ReportSection,
  ReportSectionFailure,
  ReportSectionLoading,
  ReportStandalonePage,
  ReportTable,
  ReportTrend,
  type ReportTableRow,
} from './report-screen-parts'
import type { ReportExportState } from './use-report-export'

export type PortfolioPerformanceReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: PortfolioPerformanceReportViewModel; refreshing?: boolean }

export type PortfolioPerformanceReportBodyProps = {
  state: PortfolioPerformanceReportViewState
  currencyCode: string
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

/**
 * The report covers every household portfolio over the period, so the standalone screen offers the
 * period only: the account and transaction filters of the other reports don't apply to it.
 */
export type PortfolioPerformanceReportScreenProps = PortfolioPerformanceReportBodyProps & {
  preset: ReportDatePreset
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

type Figures = Readonly<{ name: string; startValue: number | null; netContributions: number | null; change: number | null; changePercent: number | null; dividends: number | null; endValue: number | null }>

/**
 * Web's `PortfolioPerformanceReport`: a six-column table (Portfolio, Start
 * value, Net contributions, Change, Dividends, End value) that scrolls sideways
 * at phone width, biggest movers first, with a Total row when there is more
 * than one portfolio. A value the API has no snapshot for is an em dash.
 */
export function PortfolioPerformanceReportBody({ state, currencyCode, exportState, onExport, onRefresh }: PortfolioPerformanceReportBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })
  const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
  const unknown = t('reports.portfolioPerformance.unknownValue')
  // Contributions and dividends are unknown only when a trade or payout has no exchange rate.
  const noRate = t('reports.portfolioPerformance.noExchangeRate')
  const optionalMoneyLabel = (value: number | null, unknownLabel = unknown) => value === null ? unknownLabel : money(value)
  const changeLabel = (change: number | null, percent: number | null) => change === null
    ? unknown
    : percent === null ? signedMoney(change) : `${signedMoney(change)} (${formatPercentagePoints(percent, locale, { maximumFractionDigits: 2 })})`

  if (state.status === 'access-transition') return null

  const amount = (value: number | null, unknownLabel = unknown) => value === null
    ? <Text accessibilityLabel={unknownLabel} align="right" tone="muted" variant="amount">—</Text>
    : <Amount align="right" currency={currencyCode} locale={locale} value={value} />

  const toRow = (key: string, figures: Figures, emphasis?: 'total'): ReportTableRow => ({
    key,
    emphasis,
    accessibilityLabel: [
      figures.name,
      `${t('reports.portfolioPerformance.startValue')}, ${optionalMoneyLabel(figures.startValue)}`,
      `${t('reports.portfolioPerformance.netContributions')}, ${optionalMoneyLabel(figures.netContributions, noRate)}`,
      `${t('reports.portfolioPerformance.change')}, ${changeLabel(figures.change, figures.changePercent)}`,
      `${t('reports.portfolioPerformance.dividends')}, ${optionalMoneyLabel(figures.dividends, noRate)}`,
      `${t('reports.portfolioPerformance.endValue')}, ${optionalMoneyLabel(figures.endValue)}`,
    ].join(', '),
    cells: {
      portfolio: figures.name,
      startValue: amount(figures.startValue),
      netContributions: amount(figures.netContributions, noRate),
      change: figures.change === null ? amount(null) : (
        <View style={styles.change}>
          <Text align="right" variant="amount">{signedMoney(figures.change)}</Text>
          <ReportTrend percentage={figures.changePercent} value={figures.change} />
        </View>
      ),
      dividends: amount(figures.dividends, noRate),
      endValue: amount(figures.endValue),
    },
  })

  let content: React.ReactNode
  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.portfolioPerformance.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else if (state.report.rows.length === 0) {
    content = <ReportEmptyState description={t('reports.portfolioPerformance.emptyMessage')} icon="trending-up" title={t('reports.portfolioPerformance.emptyTitle')} />
  } else {
    const { rows, totals } = state.report
    const totalFigures: Figures & PortfolioPerformanceTotals = { name: t('reports.portfolioPerformance.total'), ...totals }
    content = (
      <ReportTable
        columns={[
          { key: 'portfolio', label: t('reports.portfolioPerformance.portfolio'), width: 160 },
          { key: 'startValue', label: t('reports.portfolioPerformance.startValue'), align: 'right', width: 128 },
          { key: 'netContributions', label: t('reports.portfolioPerformance.netContributions'), align: 'right', width: 160 },
          { key: 'change', label: t('reports.portfolioPerformance.change'), align: 'right', width: 144 },
          { key: 'dividends', label: t('reports.portfolioPerformance.dividends'), align: 'right', width: 112 },
          { key: 'endValue', label: t('reports.portfolioPerformance.endValue'), align: 'right', width: 128 },
        ]}
        rows={[
          ...rows.map((row) => toRow(row.portfolioKey, row)),
          ...(rows.length > 1 ? [toRow('__total__', totalFigures, 'total')] : []),
        ]}
        scrollable
      />
    )
  }

  return (
    <ReportSection
      actions={state.status === 'loading' || state.status === 'error' || state.status === 'invalid-response' ? undefined : <ReportExportButton onExport={onExport} status={exportState.status} />}
      description={t('reports.portfolioPerformance.subtitle')}
      testID="portfolio-performance-report"
      title={t('reports.portfolioPerformance.title')}
    >
      {content}
    </ReportSection>
  )
}

export function PortfolioPerformanceReportScreen({ state, preset, currencyCode, exportState, onSelectPreset, onExport, onRefresh, onBack }: PortfolioPerformanceReportScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <PortfolioPerformanceReportBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

const styles = StyleSheet.create({
  change: { alignItems: 'flex-end', gap: themeTokens.spacing[1] },
})

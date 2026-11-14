import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { formatPercentagePoints } from '@/lib/formatters/financial'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'

import type { HouseholdMembersModel, MemberFilter } from '@/features/household/member-attribution'
import { MemberFilterButton } from '@/features/household/member-filter-control'

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
 * period and the member filter only: the account and transaction filters of the other reports
 * don't apply to it.
 */
export type PortfolioPerformanceReportScreenProps = PortfolioPerformanceReportBodyProps & {
  preset: ReportDatePreset
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
  /** Whose portfolios: everyone, one member or Shared. Omitted (a household of one), not shown. */
  memberFilter?: Readonly<{ model: HouseholdMembersModel; value: MemberFilter; onChange: (value: MemberFilter) => void }>
}

type Figures = Readonly<{
  name: string
  startValue: number | null
  netContributions: number | null
  change: number | null
  changePercent: number | null
  dividends: number | null
  endValue: number | null
  timeWeightedReturn?: number | null
  moneyWeightedReturn?: number | null
  moneyWeightedReturnAnnualized?: boolean
  missingSnapshotDates?: readonly string[]
}>

/**
 * Web's `PortfolioPerformanceReport`: a six-column table (Portfolio, Start
 * value, Net contributions, Change, Dividends, End value) that scrolls sideways
 * at phone width, biggest movers first, with a Total row when there is more
 * than one portfolio. A value the API has no snapshot for is an em dash. When the API sends them,
 * Time-weighted and Money-weighted columns follow Change, explained under the table; the Total
 * row leaves them out, since neither return adds up across portfolios.
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

  const percent = (value: number) => formatPercentagePoints(value, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const notCombined = t('reports.portfolioPerformance.notCombined')
  const returnLabel = (value: number | null | undefined, unknownLabel: string, perYear = false) => value === null || value === undefined
    ? unknownLabel
    : perYear ? `${percent(value)} ${t('portfolioSections.perYear')}` : percent(value)

  if (state.status === 'access-transition') return null

  const returnCell = (value: number | null | undefined, unknownLabel: string, perYear = false) => value === null || value === undefined
    ? <Text accessibilityLabel={unknownLabel} align="right" tone="muted" variant="amount">—</Text>
    : (
      <View style={styles.change}>
        <Text align="right" variant="amount">{percent(value)}</Text>
        <ReportTrend value={value} />
        {perYear ? <Text align="right" tone="muted" variant="label">{t('portfolioSections.perYear')}</Text> : null}
      </View>
    )

  const amount = (value: number | null, unknownLabel = unknown) => value === null
    ? <Text accessibilityLabel={unknownLabel} align="right" tone="muted" variant="amount">—</Text>
    : <Amount align="right" currency={currencyCode} locale={locale} value={value} />

  const toRow = (key: string, figures: Figures, withReturns: boolean, emphasis?: 'total'): ReportTableRow => {
    const total = emphasis === 'total'
    const returnsUnknown = total ? notCombined : unknown
    const missingDays = new Set(figures.missingSnapshotDates ?? []).size
    return {
      key,
      emphasis,
      accessibilityLabel: [
        figures.name,
        `${t('reports.portfolioPerformance.startValue')}, ${optionalMoneyLabel(figures.startValue)}`,
        `${t('reports.portfolioPerformance.netContributions')}, ${optionalMoneyLabel(figures.netContributions, noRate)}`,
        `${t('reports.portfolioPerformance.change')}, ${changeLabel(figures.change, figures.changePercent)}`,
        ...(withReturns ? [
          `${t('portfolioSections.timeWeighted')}, ${returnLabel(figures.timeWeightedReturn, returnsUnknown)}`,
          `${t('portfolioSections.moneyWeighted')}, ${returnLabel(figures.moneyWeightedReturn, returnsUnknown, figures.moneyWeightedReturnAnnualized)}`,
        ] : []),
        `${t('reports.portfolioPerformance.dividends')}, ${optionalMoneyLabel(figures.dividends, noRate)}`,
        `${t('reports.portfolioPerformance.endValue')}, ${optionalMoneyLabel(figures.endValue)}`,
        ...(missingDays > 0 ? [t('portfolioSections.missingSnapshots', { count: missingDays })] : []),
      ].join(', '),
      cells: {
        portfolio: missingDays > 0 ? (
          <View style={styles.name}>
            <Text variant="meta">{figures.name}</Text>
            <Text tone="muted" variant="label">{t('reports.portfolioPerformance.daysWithoutSnapshot', { count: missingDays })}</Text>
          </View>
        ) : figures.name,
        startValue: amount(figures.startValue),
        netContributions: amount(figures.netContributions, noRate),
        change: figures.change === null ? amount(null) : (
          <View style={styles.change}>
            <Text align="right" variant="amount">{signedMoney(figures.change)}</Text>
            <ReportTrend percentage={figures.changePercent} value={figures.change} />
          </View>
        ),
        timeWeighted: returnCell(figures.timeWeightedReturn, returnsUnknown),
        moneyWeighted: returnCell(figures.moneyWeightedReturn, returnsUnknown, figures.moneyWeightedReturnAnnualized),
        dividends: amount(figures.dividends, noRate),
        endValue: amount(figures.endValue),
      },
    }
  }

  let content: React.ReactNode
  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.portfolioPerformance.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else if (state.report.rows.length === 0) {
    content = <ReportEmptyState description={t('reports.portfolioPerformance.emptyMessage')} icon="trending-up" title={t('reports.portfolioPerformance.emptyTitle')} />
  } else {
    const { rows, totals, hasPeriodReturns } = state.report
    const totalFigures: Figures & PortfolioPerformanceTotals = { name: t('reports.portfolioPerformance.total'), ...totals, timeWeightedReturn: null, moneyWeightedReturn: null }
    content = (
      <View style={styles.stack}>
        <ReportTable
          columns={[
            { key: 'portfolio', label: t('reports.portfolioPerformance.portfolio'), width: 160 },
            { key: 'startValue', label: t('reports.portfolioPerformance.startValue'), align: 'right', width: 128 },
            { key: 'netContributions', label: t('reports.portfolioPerformance.netContributions'), align: 'right', width: 160 },
            { key: 'change', label: t('reports.portfolioPerformance.change'), align: 'right', width: 144 },
            ...(hasPeriodReturns ? [
              { key: 'timeWeighted', label: t('portfolioSections.timeWeighted'), align: 'right' as const, width: 144 },
              { key: 'moneyWeighted', label: t('portfolioSections.moneyWeighted'), align: 'right' as const, width: 144 },
            ] : []),
            { key: 'dividends', label: t('reports.portfolioPerformance.dividends'), align: 'right', width: 112 },
            { key: 'endValue', label: t('reports.portfolioPerformance.endValue'), align: 'right', width: 128 },
          ]}
          rows={[
            ...rows.map((row) => toRow(row.portfolioKey, row, hasPeriodReturns)),
            ...(rows.length > 1 ? [toRow('__total__', totalFigures, hasPeriodReturns, 'total')] : []),
          ]}
          scrollable
        />
        {hasPeriodReturns ? (
          <View style={styles.notes} testID="portfolio-performance-returns-notes">
            <Text tone="muted" variant="label">{`${t('portfolioSections.timeWeighted')}: ${t('portfolioSections.timeWeightedHelp')}`}</Text>
            <Text tone="muted" variant="label">{`${t('portfolioSections.moneyWeighted')}: ${t('portfolioSections.moneyWeightedHelp')}`}</Text>
          </View>
        ) : null}
      </View>
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

export function PortfolioPerformanceReportScreen({ state, preset, currencyCode, exportState, onSelectPreset, onExport, onRefresh, onBack, memberFilter }: PortfolioPerformanceReportScreenProps) {
  if (state.status === 'access-transition') return null
  const controls = (
    <View style={styles.controls}>
      <ReportFiltersBar onSelectPreset={onSelectPreset} preset={preset} />
      {memberFilter ? (
        <View style={styles.memberFilter}>
          <MemberFilterButton model={memberFilter.model} onChange={memberFilter.onChange} value={memberFilter.value} />
        </View>
      ) : null}
    </View>
  )
  return (
    <ReportStandalonePage
      controls={controls}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <PortfolioPerformanceReportBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

const styles = StyleSheet.create({
  controls: { gap: themeTokens.spacing[2] },
  // The member filter sits under the period, at the start of the row, sized to its label.
  memberFilter: { flexDirection: 'row' },
  change: { alignItems: 'flex-end', gap: themeTokens.spacing[1] },
  name: { gap: 2 },
  stack: { gap: themeTokens.spacing[3] },
  notes: { gap: themeTokens.spacing[1] },
})

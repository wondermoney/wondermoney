import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { CartesianChart, Line } from 'victory-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { NetWorthHistoryReportViewModel } from './net-worth-history-report-view-model'
import type { ReportDatePreset } from './report-date-presets'
import { ReportFiltersBar } from './report-filters-bar'
import {
  ReportEmptyState,
  ReportExportButton,
  ReportSection,
  ReportSectionFailure,
  ReportSectionLoading,
  ReportStandalonePage,
  ReportTrend,
} from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

export type NetWorthHistoryReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: NetWorthHistoryReportViewModel; refreshing?: boolean }

export type NetWorthHistoryReportBodyProps = {
  state: NetWorthHistoryReportViewState
  currencyCode: string
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

export type NetWorthHistoryReportScreenProps = NetWorthHistoryReportBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

/**
 * Web's `NetWorthHistoryReport`: export icon and the month-over-month trend
 * ("Up +20%") in the header, the net-worth line in chart 1, then the latest
 * month's assets and liabilities centred under it.
 */
export function NetWorthHistoryReportBody({ state, currencyCode, exportState, onExport, onRefresh }: NetWorthHistoryReportBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })
  // The sign is added by hand: Hermes ignores `signDisplay` without throwing.
  const percent = (value: number) =>
    (value > 0 ? '+' : value < 0 ? '-' : '') + new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(value) / 100)
  const title = t('reports.netWorthHistory.title')

  if (state.status === 'access-transition') return null

  const exportAction = <ReportExportButton onExport={onExport} status={exportState.status} />
  let actions: React.ReactNode = exportAction
  let content: React.ReactNode

  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.netWorthHistory.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else {
    const { report } = state
    // The screen reader hears the amount behind the arrow, too.
    const trendLabel = report.trend.percent === null
      ? t('reports.netWorthHistory.trendNoBasis', { delta: money(report.trend.delta) })
      : t('reports.netWorthHistory.trend', { delta: money(report.trend.delta), percent: percent(report.trend.percent) })
    actions = (
      <>
        {exportAction}
        {report.points.length >= 2 ? (
          <View accessible accessibilityLabel={trendLabel}>
            <ReportTrend percentage={report.trend.percent} value={report.trend.delta} />
          </View>
        ) : null}
      </>
    )
    content = report.points.length === 0 ? (
      <ReportEmptyState description={t('reports.netWorthHistory.emptyMessage')} icon="trending-up" title={t('reports.netWorthHistory.emptyTitle')} />
    ) : (
      <View style={styles.body}>
        {/* The Skia canvas has nothing a screen reader can walk; the figures live in the header and the breakdown. */}
        <View accessible accessibilityLabel={title} style={styles.chart}>
          <CartesianChart data={[...report.points]} xKey="x" yKeys={['value']}>
            {({ points }) => <Line color={palette.chart1} curveType="linear" points={points.value} strokeWidth={2} />}
          </CartesianChart>
        </View>
        {report.latestBreakdown ? (
          <View style={styles.breakdown}>
            <BreakdownItem color={palette.chart2} currencyCode={currencyCode} label={t('reports.netWorthHistory.assets')} locale={locale} money={money} value={report.latestBreakdown.assets} />
            <BreakdownItem color={palette.chart3} currencyCode={currencyCode} label={t('reports.netWorthHistory.liabilities')} locale={locale} money={money} value={report.latestBreakdown.liabilities} />
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <ReportSection actions={actions} description={t('reports.netWorthHistory.subtitle')} testID="net-worth-history-report" title={title}>
      {content}
    </ReportSection>
  )
}

export function NetWorthHistoryReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: NetWorthHistoryReportScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <NetWorthHistoryReportBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

function BreakdownItem({ label, value, color, currencyCode, locale, money }: { label: string; value: number; color: string; currencyCode: string; locale: string; money: (value: number) => string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${money(value)}`} style={styles.breakdownItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text tone="muted" variant="meta">{label}</Text>
      <Amount currency={currencyCode} locale={locale} value={value} />
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[4] },
  chart: { width: '100%', height: 240 },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: themeTokens.spacing[6] },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
})

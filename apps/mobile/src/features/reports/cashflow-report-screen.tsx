import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { CartesianChart, Line } from 'victory-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { UnconvertedAmountsNote } from '@/components/ui/unconverted-amounts-note'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

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
import type { CashflowReportViewModel } from './cashflow-report-view-model'

export type CashflowReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: CashflowReportViewModel; refreshing?: boolean; completeness?: AmountsCompleteness }

export type CashflowReportBodyProps = {
  state: CashflowReportViewState
  currencyCode: string
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

export type CashflowReportScreenProps = CashflowReportBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

/**
 * Web's `CashflowReport`: the export icon and "Trailing 3-month net average"
 * with its amount in the header; income (success), expenses (destructive) and
 * net (chart 1) over the months, on the page — no box around the chart.
 */
export function CashflowReportBody({ state, currencyCode, exportState, onExport, onRefresh }: CashflowReportBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })
  const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
  const title = t('reports.cashflow.title')

  if (state.status === 'access-transition') return null

  const exportAction = <ReportExportButton onExport={onExport} status={exportState.status} />
  let actions: React.ReactNode = exportAction
  let content: React.ReactNode

  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.cashflow.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else {
    const { report } = state
    actions = (
      <>
        {exportAction}
        <View
          accessible
          accessibilityLabel={t('reports.cashflow.trailingNetAverage', { value: signedMoney(report.trailingNetAverage) })}
          style={styles.figure}
        >
          <ReportTrend label={t('reports.cashflow.trailingNetAverageLabel')} value={report.trailingNetAverage} />
          <Amount currency={currencyCode} locale={locale} value={report.trailingNetAverage} />
        </View>
      </>
    )
    content = report.points.length === 0 ? (
      <ReportEmptyState description={t('reports.cashflow.emptyMessage')} icon="arrow-left-right" title={t('reports.cashflow.emptyTitle')} />
    ) : (
      <View style={styles.body}>
        {/* The Skia canvas has nothing a screen reader can walk; the container
            carries the name, the figures live in the header and the legend. */}
        <View accessible accessibilityLabel={title} style={styles.chart}>
          <CartesianChart data={[...report.points]} xKey="x" yKeys={['income', 'expenses', 'net']}>
            {({ points }) => (
              <>
                <Line color={palette.successText} curveType="linear" points={points.income} strokeWidth={2} />
                <Line color={palette.destructiveText} curveType="linear" points={points.expenses} strokeWidth={2} />
                <Line color={palette.chart1} curveType="linear" points={points.net} strokeWidth={2} />
              </>
            )}
          </CartesianChart>
        </View>
        <View style={styles.legend}>
          <LegendItem color={palette.successText} label={t('reports.cashflow.income')} />
          <LegendItem color={palette.destructiveText} label={t('reports.cashflow.expenses')} />
          <LegendItem color={palette.chart1} label={t('reports.cashflow.net')} />
        </View>
      </View>
    )
  }

  return (
    <ReportSection actions={actions} description={t('reports.cashflow.subtitle')} testID="cashflow-report" title={title}>
      {content}
      {state.status === 'loaded' ? <UnconvertedAmountsNote completeness={state.completeness} testID="cashflow-report-unconverted" /> : null}
    </ReportSection>
  )
}

export function CashflowReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: CashflowReportScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <CashflowReportBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

function LegendItem({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text tone="muted" variant="label">{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  figure: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[2], rowGap: themeTokens.spacing[1] },
  body: { gap: themeTokens.spacing[3] },
  chart: { width: '100%', height: 240 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: themeTokens.spacing[4] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
})

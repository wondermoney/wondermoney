import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Text } from '@/components/ui/text'
import { UnconvertedAmountsNote } from '@/components/ui/unconverted-amounts-note'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
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
  useReportCategoryName,
} from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'
import type { SpendingByCategoryBar, SpendingByCategoryReportViewModel } from './spending-by-category-report-view-model'

export type SpendingByCategoryReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: SpendingByCategoryReportViewModel; trendReady: boolean; refreshing?: boolean; completeness?: AmountsCompleteness }

export type SpendingByCategoryReportBodyProps = {
  state: SpendingByCategoryReportViewState
  currencyCode: string
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

export type SpendingByCategoryReportScreenProps = SpendingByCategoryReportBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

/**
 * Web's `resolveCategoryColor`: the API hands back `#000000` for a category
 * with no colour ("Uncategorized"), which painted the biggest bar a black slab.
 * Treat it as no colour and fall back onto the chart ramp by position; "Other"
 * is muted, as on web.
 */
function barColor(bar: SpendingByCategoryBar, index: number, palette: Palette): string {
  if (bar.key === '__other__') return palette.mutedForeground
  const color = bar.color?.trim().toLowerCase()
  if (color && !/^#0{3}(?:0{3})?$/.test(color)) return bar.color
  const ramp = [palette.chart1, palette.chart2, palette.chart3, palette.chart4, palette.chart5]
  return ramp[index % ramp.length]!
}

/**
 * Web's `SpendingByCategoryReport`: the header carries the export icon,
 * "Total spent" and its amount, and the trend vs. the prior period (spending
 * less is the good direction). The body is the top 12 categories as
 * horizontal bars, the rest folded into "Other".
 */
export function SpendingByCategoryReportBody({ state, currencyCode, exportState, onExport, onRefresh }: SpendingByCategoryReportBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const categoryName = useReportCategoryName()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })

  if (state.status === 'access-transition') return null

  const exportAction = <ReportExportButton onExport={onExport} status={exportState.status} />
  let actions: React.ReactNode = exportAction
  let content: React.ReactNode

  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.spendingByCategory.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else {
    const { report, trendReady } = state
    actions = (
      <>
        {exportAction}
        <View accessible accessibilityLabel={`${t('reports.spendingByCategory.total')}, ${money(report.total)}`} style={styles.figure}>
          <Text tone="muted" variant="label">{t('reports.spendingByCategory.total')}</Text>
          <Amount currency={currencyCode} locale={locale} value={report.total} />
        </View>
        {trendReady ? (
          <ReportTrend
            direction="positive-is-down"
            label={t('reports.trend.vsPriorPeriod')}
            percentage={report.trend.percent === null ? undefined : Math.abs(report.trend.percent)}
            value={report.trend.delta}
          />
        ) : null}
      </>
    )
    content = report.bars.length === 0 ? (
      <ReportEmptyState description={t('reports.spendingByCategory.emptyMessage')} icon="pie-chart" title={t('reports.spendingByCategory.emptyTitle')} />
    ) : (
      <View style={styles.list}>
        {report.bars.map((bar, index) => {
          const name = categoryName(bar.name)
          return (
            <View key={bar.key} accessible accessibilityLabel={`${name}, ${money(bar.amount)}`} style={styles.barRow}>
              <View style={styles.barHeading}>
                <Text numberOfLines={1} style={styles.barName} variant="meta">{name}</Text>
                <Amount currency={currencyCode} locale={locale} value={bar.amount} />
              </View>
              <ProgressBar color={barColor(bar, index, palette)} testID={`spending-bar-${bar.key}`} value={bar.widthPercent} />
            </View>
          )
        })}
      </View>
    )
  }

  return (
    <ReportSection actions={actions} description={t('reports.spendingByCategory.subtitle')} testID="spending-by-category-report" title={t('reports.spendingByCategory.title')}>
      {content}
      {state.status === 'loaded' ? <UnconvertedAmountsNote completeness={state.completeness} testID="spending-by-category-report-unconverted" /> : null}
    </ReportSection>
  )
}

export function SpendingByCategoryReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: SpendingByCategoryReportScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <SpendingByCategoryReportBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

const styles = StyleSheet.create({
  figure: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  list: { gap: themeTokens.spacing[3] },
  barRow: { gap: themeTokens.spacing[1] },
  barHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  barName: { flex: 1 },
  track: { height: 8, borderRadius: themeTokens.radius.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.sm },
})

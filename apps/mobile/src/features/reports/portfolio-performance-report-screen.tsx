import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { ReportDatePreset } from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportExportButton, ReportPresetBar, ReportSectionFailure, ReportSectionHeading, ReportSectionLoading, styles as sharedStyles } from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'
import type { PortfolioPerformanceReportViewModel } from './portfolio-performance-report-view-model'

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

export type PortfolioPerformanceReportScreenProps = PortfolioPerformanceReportBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

export function PortfolioPerformanceReportBody({ state, currencyCode, exportState, onExport, onRefresh }: PortfolioPerformanceReportBodyProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: currencyCode })
  const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
  const title = t('reports.portfolioPerformance.title')
  const helper = t('reports.portfolioPerformance.subtitle')

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionLoading label={t('reports.portfolioPerformance.loading')} palette={palette} />
      </View>
    )
  }

  if (state.status === 'error' || state.status === 'invalid-response') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionFailure
          message={t(state.status === 'invalid-response' ? 'reports.invalidMessage' : 'reports.errorMessage')}
          onRetry={onRefresh}
          palette={palette}
        />
      </View>
    )
  }

  const { report } = state
  const aggregateGaining = report.aggregateReturn >= 0

  return (
    <View style={sharedStyles.section}>
      <ReportSectionHeading title={title} helper={helper} palette={palette} />
      <ReportExportButton status={exportState.status} onExport={onExport} palette={palette} />

      {report.rows.length === 0 ? (
        <View style={[sharedStyles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.emptyTitle, { color: palette.foreground }]}>
            {t('reports.portfolioPerformance.emptyTitle')}
          </Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>
            {t('reports.portfolioPerformance.emptyMessage')}
          </Text>
        </View>
      ) : (
        <>
          <Text
            accessible
            accessibilityLabel={t('reports.portfolioPerformance.aggregateReturn', { value: signedMoney(report.aggregateReturn) })}
            allowFontScaling
            style={[styles.aggregate, { color: aggregateGaining ? palette.successText : palette.destructiveText }]}
          >
            {t('reports.portfolioPerformance.aggregateReturn', { value: signedMoney(report.aggregateReturn) })}
          </Text>

          <View style={styles.list}>
            {report.rows.map((row) => {
              const label = [
                row.name,
                row.currency,
                `${t('reports.portfolioPerformance.startBalance')}, ${money(row.startBalance)}`,
                `${t('reports.portfolioPerformance.contributions')}, ${money(row.contributions)}`,
                `${t('reports.portfolioPerformance.return')}, ${signedMoney(row.return)}`,
                `${t('reports.portfolioPerformance.endBalance')}, ${money(row.endBalance)}`,
              ].join(', ')
              return (
                <View key={row.accountKey} accessible accessibilityLabel={label} style={[styles.row, { borderColor: palette.border, backgroundColor: palette.card }]}>
                  <View style={styles.rowTop}>
                    <Text allowFontScaling style={[styles.rowName, { color: palette.foreground }]}>{row.name}</Text>
                    <Text allowFontScaling style={[styles.rowCurrency, { color: palette.mutedForeground }]}>{row.currency}</Text>
                  </View>
                  <View style={styles.rowMetrics}>
                    <Metric label={t('reports.portfolioPerformance.startBalance')} value={money(row.startBalance)} palette={palette} />
                    <Metric label={t('reports.portfolioPerformance.contributions')} value={money(row.contributions)} palette={palette} />
                    <Metric label={t('reports.portfolioPerformance.return')} value={signedMoney(row.return)} valueColor={row.gaining ? palette.successText : palette.destructiveText} palette={palette} />
                    <Metric label={t('reports.portfolioPerformance.endBalance')} value={money(row.endBalance)} palette={palette} />
                  </View>
                </View>
              )
            })}
          </View>
          <Text allowFontScaling style={[styles.caveat, { color: palette.mutedForeground }]}>{t('reports.portfolioPerformance.startCaveat')}</Text>
        </>
      )}
    </View>
  )
}

export function PortfolioPerformanceReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: PortfolioPerformanceReportScreenProps) {
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (state.status === 'access-transition') return null
  return (
    <SafeAreaView style={[sharedStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={sharedStyles.content}
        refreshControl={<RefreshControl refreshing={Boolean(state.status === 'loaded' && state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
      >
        <View style={sharedStyles.page}>
          <BackControl fallback="/reports" onPress={onBack} color={palette.primary} />
          <ReportPresetBar preset={preset} onSelectPreset={onSelectPreset} palette={palette} />
          <ReportFilterPanel filterState={filterState} filterOptions={filterOptions} palette={palette} />
          <PortfolioPerformanceReportBody state={state} currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Metric({ label, value, valueColor, palette }: { label: string; value: string; valueColor?: string; palette: Palette }) {
  return (
    <View style={styles.metric}>
      <Text allowFontScaling style={[styles.metricLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.metricValue, { color: valueColor ?? palette.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  aggregate: { ...textStyles.amount, textAlign: 'center' },
  list: { gap: themeTokens.spacing[3] },
  row: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[3] },
  rowName: { ...textStyles.action },
  rowCurrency: { ...textStyles.amountSmall },
  rowMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[4] },
  metric: { gap: themeTokens.spacing[1] },
  metricLabel: { ...textStyles.label },
  metricValue: { ...textStyles.amount },
  caveat: { ...textStyles.label },
})

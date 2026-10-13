import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CartesianChart, Line } from 'victory-native'

import { BackControl } from '@/components/ui/back-control'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { ReportDatePreset } from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportExportButton, ReportPresetBar, ReportSectionFailure, ReportSectionHeading, ReportSectionLoading, styles as sharedStyles } from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'
import type { CashflowReportViewModel } from './cashflow-report-view-model'

export type CashflowReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: CashflowReportViewModel; refreshing?: boolean }

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

/** The report's title, export action, and content — no preset/filter bar and
 * no page chrome, so it can be composed inline as one section of the
 * reports hub (which shares one preset/filter bar across all sections) or
 * wrapped by CashflowReportScreen below for standalone use. */
export function CashflowReportBody({ state, currencyCode, exportState, onExport, onRefresh }: CashflowReportBodyProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: currencyCode })
  const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
  const title = t('reports.cashflow.title')
  const helper = t('reports.cashflow.subtitle')

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionLoading label={t('reports.cashflow.loading')} palette={palette} />
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
  const trailingGaining = report.trailingNetAverage >= 0
  const trailingLabel = t('reports.cashflow.trailingNetAverage', { value: signedMoney(report.trailingNetAverage) })

  return (
    <View style={sharedStyles.section}>
      <ReportSectionHeading title={title} helper={helper} palette={palette} />
      <ReportExportButton status={exportState.status} onExport={onExport} palette={palette} />

      {report.points.length === 0 ? (
        <View style={[sharedStyles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.emptyTitle, { color: palette.foreground }]}>
            {t('reports.cashflow.emptyTitle')}
          </Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>
            {t('reports.cashflow.emptyMessage')}
          </Text>
        </View>
      ) : (
        <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
          {/* CartesianChart/Line render onto a Skia canvas with no screen-reader-navigable
              content — the container gets a static label, and the real figures live in the
              accessible legend and trailing-average text below. */}
          <View accessible accessibilityLabel={title} style={styles.chart}>
            <CartesianChart data={[...report.points]} xKey="x" yKeys={['income', 'expenses', 'net']}>
              {({ points }) => (
                <>
                  <Line points={points.income} color={palette.chart1} strokeWidth={2} curveType="linear" />
                  <Line points={points.expenses} color={palette.chart2} strokeWidth={2} curveType="linear" />
                  <Line points={points.net} color={palette.chart3} strokeWidth={2} curveType="linear" />
                </>
              )}
            </CartesianChart>
          </View>

          <View style={styles.legend}>
            <LegendItem label={t('reports.cashflow.income')} color={palette.chart1} palette={palette} />
            <LegendItem label={t('reports.cashflow.expenses')} color={palette.chart2} palette={palette} />
            <LegendItem label={t('reports.cashflow.net')} color={palette.chart3} palette={palette} />
          </View>

          <Text
            accessible
            accessibilityLabel={trailingLabel}
            allowFontScaling
            style={[styles.trailing, { color: trailingGaining ? palette.successText : palette.destructiveText }]}
          >
            {trailingLabel}
          </Text>
        </View>
      )}
    </View>
  )
}

export function CashflowReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: CashflowReportScreenProps) {
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
          <CashflowReportBody state={state} currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function LegendItem({ label, color, palette }: { label: string; color: string; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors] }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text allowFontScaling style={[styles.legendLabel, { color: palette.mutedForeground }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  chart: { width: '100%', height: 220 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: themeTokens.spacing[4] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...textStyles.meta },
  trailing: { ...textStyles.amount, textAlign: 'center' },
})

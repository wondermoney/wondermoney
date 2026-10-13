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
import type { NetWorthHistoryReportViewModel } from './net-worth-history-report-view-model'

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

export function NetWorthHistoryReportBody({ state, currencyCode, exportState, onExport, onRefresh }: NetWorthHistoryReportBodyProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: currencyCode })
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(value / 100)
  const title = t('reports.netWorthHistory.title')
  const helper = t('reports.netWorthHistory.subtitle')

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionLoading label={t('reports.netWorthHistory.loading')} palette={palette} />
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
  const gaining = report.trend.delta >= 0
  const trendLabel = report.trend.percent === null
    ? t('reports.netWorthHistory.trendNoBasis', { delta: money(report.trend.delta) })
    : t('reports.netWorthHistory.trend', { delta: money(report.trend.delta), percent: percent(report.trend.percent) })

  return (
    <View style={sharedStyles.section}>
      <ReportSectionHeading title={title} helper={helper} palette={palette} />
      <ReportExportButton status={exportState.status} onExport={onExport} palette={palette} />

      {report.points.length === 0 ? (
        <View style={[sharedStyles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.emptyTitle, { color: palette.foreground }]}>
            {t('reports.netWorthHistory.emptyTitle')}
          </Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>
            {t('reports.netWorthHistory.emptyMessage')}
          </Text>
        </View>
      ) : (
        <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
          {/* CartesianChart/Line render onto a Skia canvas with no screen-reader-navigable
              content of its own — the container gets a static label, and the real figures live
              in the accessible trend/breakdown text below. */}
          <View accessible accessibilityLabel={title} style={styles.chart}>
            <CartesianChart data={[...report.points]} xKey="x" yKeys={['value']}>
              {({ points }) => <Line points={points.value} color={palette.chart1} strokeWidth={2} curveType="linear" />}
            </CartesianChart>
          </View>

          {report.points.length >= 2 ? (
            <Text accessible accessibilityLabel={trendLabel} allowFontScaling style={[styles.trend, { color: report.trend.percent === null ? palette.mutedForeground : gaining ? palette.successText : palette.destructiveText }]}>
              {trendLabel}
            </Text>
          ) : null}

          {report.latestBreakdown ? (
            <View style={styles.breakdown}>
              <BreakdownItem label={t('reports.netWorthHistory.assets')} value={money(report.latestBreakdown.assets)} palette={palette} />
              <BreakdownItem label={t('reports.netWorthHistory.liabilities')} value={money(report.latestBreakdown.liabilities)} palette={palette} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}

export function NetWorthHistoryReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: NetWorthHistoryReportScreenProps) {
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
          <NetWorthHistoryReportBody state={state} currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function BreakdownItem({ label, value, palette }: { label: string; value: string; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors] }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.breakdownItem}>
      <Text allowFontScaling style={[styles.breakdownLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.breakdownValue, { color: palette.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  chart: { width: '100%', height: 220 },
  trend: { ...textStyles.amount, textAlign: 'center' },
  breakdown: { flexDirection: 'row', justifyContent: 'center', gap: themeTokens.spacing[6] },
  breakdownItem: { alignItems: 'center', gap: themeTokens.spacing[1] },
  breakdownLabel: { ...textStyles.label },
  breakdownValue: { ...textStyles.amount },
})

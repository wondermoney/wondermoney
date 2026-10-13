import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { ReportDatePreset } from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportExportButton, ReportPresetBar, ReportSectionFailure, ReportSectionHeading, ReportSectionLoading, styles as sharedStyles } from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'
import type { SpendingByCategoryReportViewModel } from './spending-by-category-report-view-model'

export type SpendingByCategoryReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: SpendingByCategoryReportViewModel; trendReady: boolean; refreshing?: boolean }

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

export function SpendingByCategoryReportBody({ state, currencyCode, exportState, onExport, onRefresh }: SpendingByCategoryReportBodyProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: currencyCode })
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(value / 100)
  const title = t('reports.spendingByCategory.title')
  const helper = t('reports.spendingByCategory.subtitle')

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionLoading label={t('reports.spendingByCategory.loading')} palette={palette} />
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

  const { report, trendReady } = state
  // Spending trend is inverted vs. a typical gain: spending MORE than the prior period is the
  // unwelcome direction (shown as negative), spending less is favorable (shown as positive).
  const spendingUp = report.trend.delta > 0
  const trendLabel = report.trend.percent === null
    ? t('reports.spendingByCategory.trendNoBasis', { delta: money(Math.abs(report.trend.delta)) })
    : t('reports.spendingByCategory.trend', { delta: money(Math.abs(report.trend.delta)), percent: percent(Math.abs(report.trend.percent)) })

  return (
    <View style={sharedStyles.section}>
      <ReportSectionHeading title={title} helper={helper} palette={palette} />
      <ReportExportButton status={exportState.status} onExport={onExport} palette={palette} />

      {report.bars.length === 0 ? (
        <View style={[sharedStyles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.emptyTitle, { color: palette.foreground }]}>
            {t('reports.spendingByCategory.emptyTitle')}
          </Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>
            {t('reports.spendingByCategory.emptyMessage')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.totalRow}>
            <Text
              accessible
              accessibilityLabel={[
                `${t('reports.spendingByCategory.total')}, ${money(report.total)}`,
                trendReady && report.trend.delta !== 0 ? trendLabel : null,
              ].filter(Boolean).join(', ')}
              allowFontScaling
              style={[styles.total, { color: palette.foreground }]}
            >
              {t('reports.spendingByCategory.total')}: {money(report.total)}
            </Text>
            {trendReady && report.trend.delta !== 0 ? (
              <Text allowFontScaling style={[styles.trend, { color: report.trend.percent === null ? palette.mutedForeground : spendingUp ? palette.destructiveText : palette.successText }]}>
                {trendLabel}
              </Text>
            ) : null}
          </View>

          <View style={styles.list}>
            {report.bars.map((bar) => (
              <View key={bar.key} accessible accessibilityLabel={`${formatCategoryName(bar.name)}, ${money(bar.amount)}`} style={styles.barRow}>
                <View style={styles.barHeading}>
                  <Text allowFontScaling style={[styles.barName, { color: palette.foreground }]}>{formatCategoryName(bar.name)}</Text>
                  <Text allowFontScaling style={[styles.barAmount, { color: palette.foreground }]}>{money(bar.amount)}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: palette.muted }]}>
                  <View testID={`spending-bar-${bar.key}`} style={[styles.fill, { width: `${bar.widthPercent}%`, backgroundColor: bar.color }]} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

export function SpendingByCategoryReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: SpendingByCategoryReportScreenProps) {
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
          <SpendingByCategoryReportBody state={state} currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  totalRow: { gap: themeTokens.spacing[1] },
  total: { ...textStyles.amount },
  trend: { ...textStyles.meta, fontWeight: '600' as const },
  list: { gap: themeTokens.spacing[4] },
  barRow: { gap: themeTokens.spacing[1] },
  barHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  barName: { ...textStyles.body, flex: 1 },
  barAmount: { ...textStyles.amount },
  track: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.pill },
})

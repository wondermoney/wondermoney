import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { ReportDatePreset } from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportExportButton, ReportPresetBar, ReportSectionFailure, ReportSectionHeading, ReportSectionLoading, styles as sharedStyles } from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'
import type { BudgetVsActualReportViewModel } from './budget-vs-actual-view-model'

export type BudgetVsActualViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: BudgetVsActualReportViewModel; refreshing?: boolean }

export type BudgetVsActualBodyProps = {
  state: BudgetVsActualViewState
  currencyCode: string
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

export type BudgetVsActualScreenProps = BudgetVsActualBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

export function BudgetVsActualBody({ state, currencyCode, exportState, onExport, onRefresh }: BudgetVsActualBodyProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: currencyCode })
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)
  const title = t('reports.budgetVsActual.title')
  const helper = t('reports.budgetVsActual.subtitle')

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionLoading label={t('reports.budgetVsActual.loading')} palette={palette} />
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

  return (
    <View style={sharedStyles.section}>
      <ReportSectionHeading title={title} helper={helper} palette={palette} />
      <ReportExportButton status={exportState.status} onExport={onExport} palette={palette} />

      {state.report.rows.length === 0 ? (
        <View style={[sharedStyles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.emptyTitle, { color: palette.foreground }]}>
            {t('reports.budgetVsActual.emptyTitle')}
          </Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>
            {t('reports.budgetVsActual.emptyMessage')}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {state.report.rows.map((row) => {
            const label = [
              formatCategoryName(row.name),
              `${t('reports.budgetVsActual.budgeted')}, ${money(row.budgeted)}`,
              `${t('reports.budgetVsActual.actual')}, ${money(row.actual)}`,
              `${t('reports.budgetVsActual.variance')}, ${money(row.variance)}`,
              `${t('reports.budgetVsActual.percentUsed')}, ${percent(row.percentUsed)}`,
              row.overBudget ? t('reports.budgetVsActual.overBudget') : null,
            ].filter(Boolean).join(', ')
            return (
              <View
                key={row.categoryKey}
                accessible
                accessibilityLabel={label}
                style={[
                  styles.row,
                  { borderColor: palette.border, backgroundColor: palette.card },
                  row.overBudget && { borderColor: palette.destructiveText, borderLeftWidth: 3 },
                ]}
              >
                <View style={styles.rowTop}>
                  <View style={styles.rowHeading}>
                    <View style={[styles.dot, { backgroundColor: row.color }]} />
                    <Text allowFontScaling style={[styles.rowName, { color: palette.foreground }]}>{formatCategoryName(row.name)}</Text>
                  </View>
                  {row.overBudget ? (
                    <Text allowFontScaling style={[styles.overBudgetTag, { color: palette.destructiveText }]}>
                      {t('reports.budgetVsActual.overBudget')}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rowMetrics}>
                  <Metric label={t('reports.budgetVsActual.budgeted')} value={money(row.budgeted)} palette={palette} />
                  <Metric label={t('reports.budgetVsActual.actual')} value={money(row.actual)} palette={palette} />
                  <Metric label={t('reports.budgetVsActual.variance')} value={money(row.variance)} palette={palette} />
                  <Metric label={t('reports.budgetVsActual.percentUsed')} value={percent(row.percentUsed)} palette={palette} />
                </View>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

export function BudgetVsActualScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: BudgetVsActualScreenProps) {
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
          <BudgetVsActualBody state={state} currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Metric({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={styles.metric}>
      <Text allowFontScaling style={[styles.metricLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.metricValue, { color: palette.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: themeTokens.spacing[3] },
  row: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[3] },
  rowHeading: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowName: { ...textStyles.action },
  overBudgetTag: { ...textStyles.label, fontWeight: '600' as const },
  rowMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[4] },
  metric: { gap: themeTokens.spacing[1] },
  metricLabel: { ...textStyles.label },
  metricValue: { ...textStyles.amount },
})

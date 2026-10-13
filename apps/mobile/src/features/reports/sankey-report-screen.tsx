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
import type { SankeyReportViewModel } from './sankey-report-view-model'

export type SankeyReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: SankeyReportViewModel; refreshing?: boolean }

export type SankeyReportBodyProps = {
  state: SankeyReportViewState
  currencyCode: string
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

export type SankeyReportScreenProps = SankeyReportBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

export function SankeyReportBody({ state, currencyCode, exportState, onExport, onRefresh }: SankeyReportBodyProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatCurrency(value, { locale, currency: currencyCode })
  const title = t('reports.sankey.title')
  const helper = t('reports.sankey.subtitle')

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <View style={sharedStyles.section}>
        <ReportSectionHeading title={title} helper={helper} palette={palette} />
        <ReportSectionLoading label={t('reports.sankey.loading')} palette={palette} />
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

  return (
    <View style={sharedStyles.section}>
      <ReportSectionHeading title={title} helper={helper} palette={palette} />
      <ReportExportButton status={exportState.status} onExport={onExport} palette={palette} />

      {report.links.length === 0 ? (
        <View style={[sharedStyles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.emptyTitle, { color: palette.foreground }]}>
            {t('reports.sankey.emptyTitle')}
          </Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>
            {t('reports.sankey.emptyMessage')}
          </Text>
        </View>
      ) : (
        <>
          <Text
            accessible
            accessibilityLabel={t('reports.sankey.total', { value: money(report.total) })}
            allowFontScaling
            style={[styles.total, { color: palette.foreground }]}
          >
            {t('reports.sankey.total', { value: money(report.total) })}
          </Text>

          <View style={[styles.table, { borderColor: palette.border }]}>
            <View style={[styles.tableRow, styles.tableHeaderRow, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text allowFontScaling style={[styles.headerCell, styles.sourceCell, { color: palette.mutedForeground }]}>{t('reports.sankey.source')}</Text>
              <Text allowFontScaling style={[styles.headerCell, styles.targetCell, { color: palette.mutedForeground }]}>{t('reports.sankey.target')}</Text>
              <Text allowFontScaling style={[styles.headerCell, styles.valueCell, { color: palette.mutedForeground }]}>{t('reports.sankey.value')}</Text>
            </View>
            {report.links.map((link) => (
              <View
                key={link.key}
                accessible
                accessibilityLabel={`${formatCategoryName(link.sourceLabel)} → ${formatCategoryName(link.targetLabel)}, ${money(link.value)}`}
                style={[styles.tableRow, { borderColor: palette.border }]}
              >
                <Text allowFontScaling style={[styles.cell, styles.sourceCell, { color: palette.foreground }]}>{formatCategoryName(link.sourceLabel)}</Text>
                <Text allowFontScaling style={[styles.cell, styles.targetCell, { color: palette.foreground }]}>{formatCategoryName(link.targetLabel)}</Text>
                <Text allowFontScaling style={[styles.cell, styles.valueCell, { color: palette.foreground }]}>{money(link.value)}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

export function SankeyReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: SankeyReportScreenProps) {
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
          <SankeyReportBody state={state} currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  total: { ...textStyles.amount },
  table: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', paddingVertical: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[3], gap: themeTokens.spacing[2], borderTopWidth: 1 },
  tableHeaderRow: { borderTopWidth: 0 },
  headerCell: { ...textStyles.label, fontWeight: '600' as const },
  cell: { ...textStyles.body },
  sourceCell: { flex: 1 },
  targetCell: { flex: 1 },
  valueCell: { fontFamily: themeTokens.typography.roles.data.fontFamily, textAlign: 'right', minWidth: 90 },
})

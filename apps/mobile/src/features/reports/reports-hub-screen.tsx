import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { PageHeader } from '@/components/ui/page-header'
import { BackControl } from '@/components/ui/back-control'
import { themeTokens } from '@/theme/tokens'

import { BudgetVsActualBody, type BudgetVsActualBodyProps } from './budget-vs-actual-screen'
import { CashflowReportBody, type CashflowReportBodyProps } from './cashflow-report-screen'
import { NetWorthHistoryReportBody, type NetWorthHistoryReportBodyProps } from './net-worth-history-report-screen'
import { PortfolioPerformanceReportBody, type PortfolioPerformanceReportBodyProps } from './portfolio-performance-report-screen'
import type { ReportDatePreset } from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportPresetBar, styles as sharedStyles } from './report-screen-parts'
import { SankeyReportBody, type SankeyReportBodyProps } from './sankey-report-screen'
import { SpendingByCategoryReportBody, type SpendingByCategoryReportBodyProps } from './spending-by-category-report-screen'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

export type ReportsHubScreenProps = {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  refreshing: boolean
  onRefreshAll: () => void | Promise<void>
  onBack: () => void
  sankey: SankeyReportBodyProps
  cashflow: CashflowReportBodyProps
  spendingByCategory: SpendingByCategoryReportBodyProps
  netWorthHistory: NetWorthHistoryReportBodyProps
  budgetVsActual: BudgetVsActualBodyProps
  portfolioPerformance: PortfolioPerformanceReportBodyProps
}

/**
 * All six reports composed inline on one scrolling page, matching web's
 * `/reports`, so the two platforms feel like the same app for a surface
 * that's otherwise identical. One shared date-range/filter bar
 * controls every section, same as web's single `ReportFiltersBar`; each
 * section still tracks its own load/error/export state independently,
 * since each is backed by a different endpoint.
 */
export function ReportsHubScreen({
  preset,
  filterState,
  filterOptions,
  onSelectPreset,
  refreshing,
  onRefreshAll,
  onBack,
  sankey,
  cashflow,
  spendingByCategory,
  netWorthHistory,
  budgetVsActual,
  portfolioPerformance,
}: ReportsHubScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']

  return (
    <SafeAreaView style={[sharedStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={sharedStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefreshAll()} tintColor={palette.primary} />}
      >
        <View style={sharedStyles.page}>
          <View style={styles.header}>
            <BackControl fallback="/more" onPress={onBack} color={palette.primary} />
            <PageHeader palette={palette} helpText={t('reportsHub.helper')} title={t('reportsHub.title')} />
          </View>

          <ReportPresetBar preset={preset} onSelectPreset={onSelectPreset} palette={palette} />
          <ReportFilterPanel filterState={filterState} filterOptions={filterOptions} palette={palette} />

          {/* Flagship Sankey first — same prime placement as web. */}
          <SankeyReportBody {...sankey} />
          <CashflowReportBody {...cashflow} />
          <SpendingByCategoryReportBody {...spendingByCategory} />
          <NetWorthHistoryReportBody {...netWorthHistory} />
          <BudgetVsActualBody {...budgetVsActual} />
          <PortfolioPerformanceReportBody {...portfolioPerformance} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  header: { gap: themeTokens.spacing[4] },
})

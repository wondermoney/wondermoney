import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { usePalette } from '@/theme/use-palette'

import { BudgetVsActualBody, type BudgetVsActualBodyProps } from './budget-vs-actual-screen'
import { CashflowReportBody, type CashflowReportBodyProps } from './cashflow-report-screen'
import { MonthComparisonReportBody, type MonthComparisonReportBodyProps } from './month-comparison-report-screen'
import { NetWorthHistoryReportBody, type NetWorthHistoryReportBodyProps } from './net-worth-history-report-screen'
import { PortfolioPerformanceReportBody, type PortfolioPerformanceReportBodyProps } from './portfolio-performance-report-screen'
import type { ReportDatePreset } from './report-date-presets'
import { ReportFiltersBar } from './report-filters-bar'
import { styles as sharedStyles } from './report-screen-parts'
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
  sankey: SankeyReportBodyProps
  cashflow: CashflowReportBodyProps
  spendingByCategory: SpendingByCategoryReportBodyProps
  monthComparison: MonthComparisonReportBodyProps
  netWorthHistory: NetWorthHistoryReportBodyProps
  budgetVsActual: BudgetVsActualBodyProps
  portfolioPerformance: PortfolioPerformanceReportBodyProps
}

/**
 * Web's `/reports` at phone width: the "Reports" title, one filter row (period
 * select, Filters, reset), then every report as an open section in web's order
 * — Sankey, cash flow, spending by category, month comparison, net worth,
 * budget vs actual, portfolio performance. Each section keeps its own query, export and
 * load/error state, so one failing report doesn't block the rest. Reports is
 * a destination (the bottom bar's More), so there is no back link, as on web.
 */
export function ReportsHubScreen({
  preset,
  filterState,
  filterOptions,
  onSelectPreset,
  refreshing,
  onRefreshAll,
  sankey,
  cashflow,
  spendingByCategory,
  monthComparison,
  netWorthHistory,
  budgetVsActual,
  portfolioPerformance,
}: ReportsHubScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

  return (
    <SafeAreaView style={[sharedStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={sharedStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefreshAll()} tintColor={palette.primary} />}
      >
        <View style={sharedStyles.page}>
          {/* The title, then the one control row, then the reports. */}
          <View style={styles.lead}>
            <PageHeader title={t('reportsHub.title')} />
            <ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />
          </View>
          <View style={sharedStyles.reports}>
            <SankeyReportBody {...sankey} />
            <CashflowReportBody {...cashflow} />
            <SpendingByCategoryReportBody {...spendingByCategory} />
            <MonthComparisonReportBody {...monthComparison} />
            <NetWorthHistoryReportBody {...netWorthHistory} />
            <BudgetVsActualBody {...budgetVsActual} />
            <PortfolioPerformanceReportBody {...portfolioPerformance} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  lead: { gap: themeTokens.spacing[4] },
})

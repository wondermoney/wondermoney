import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { UnconvertedAmountsNote } from '@/components/ui/unconverted-amounts-note'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'

import type { BudgetVsActualReportViewModel } from './budget-vs-actual-view-model'
import type { ReportDatePreset } from './report-date-presets'
import { ReportFiltersBar } from './report-filters-bar'
import {
  ReportEmptyState,
  ReportExportButton,
  ReportSection,
  ReportSectionFailure,
  ReportSectionLoading,
  ReportStandalonePage,
  ReportTable,
  useReportCategoryName,
} from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

export type BudgetVsActualViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: BudgetVsActualReportViewModel; refreshing?: boolean; completeness?: AmountsCompleteness }

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

/**
 * Web's `BudgetVsActualReport`: a five-column table (Category, Budgeted,
 * Actual, Variance, % Used) that scrolls sideways at phone width, most-used
 * first. An over-budget row takes a faint destructive wash and "Over budget"
 * in destructive text beside the name — the word carries the state.
 */
export function BudgetVsActualBody({ state, currencyCode, exportState, onExport, onRefresh }: BudgetVsActualBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const categoryName = useReportCategoryName()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)

  if (state.status === 'access-transition') return null

  let content: React.ReactNode
  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.budgetVsActual.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else if (state.report.rows.length === 0) {
    content = <ReportEmptyState description={t('reports.budgetVsActual.emptyMessage')} icon="piggy-bank" title={t('reports.budgetVsActual.emptyTitle')} />
  } else {
    const amount = (value: number) => <Amount align="right" currency={currencyCode} locale={locale} value={value} />
    content = (
      <ReportTable
        columns={[
          { key: 'category', label: t('reports.budgetVsActual.category'), width: 200 },
          { key: 'budgeted', label: t('reports.budgetVsActual.budgeted'), align: 'right', width: 120 },
          { key: 'actual', label: t('reports.budgetVsActual.actual'), align: 'right', width: 120 },
          { key: 'variance', label: t('reports.budgetVsActual.variance'), align: 'right', width: 120 },
          { key: 'percentUsed', label: t('reports.budgetVsActual.percentUsed'), align: 'right', width: 88 },
        ]}
        rows={state.report.rows.map((row) => {
          const name = categoryName(row.name)
          return {
            key: row.categoryKey,
            emphasis: row.overBudget ? 'over' as const : undefined,
            accessibilityLabel: [
              name,
              `${t('reports.budgetVsActual.budgeted')}, ${money(row.budgeted)}`,
              `${t('reports.budgetVsActual.actual')}, ${money(row.actual)}`,
              `${t('reports.budgetVsActual.variance')}, ${money(row.variance)}`,
              `${t('reports.budgetVsActual.percentUsed')}, ${percent(row.percentUsed)}`,
              row.overBudget ? t('reports.budgetVsActual.overBudget') : null,
            ].filter(Boolean).join(', '),
            cells: {
              category: (
                <View style={styles.category}>
                  <View style={[styles.dot, { backgroundColor: row.color }]} />
                  <Text variant="meta">{name}</Text>
                  {row.overBudget ? <Text style={styles.over} tone="destructive" variant="label">{t('reports.budgetVsActual.overBudget')}</Text> : null}
                </View>
              ),
              budgeted: amount(row.budgeted),
              actual: amount(row.actual),
              variance: amount(row.variance),
              percentUsed: <Text align="right" variant="amount">{percent(row.percentUsed)}</Text>,
            },
          }
        })}
        scrollable
      />
    )
  }

  return (
    <ReportSection
      actions={state.status === 'loading' || state.status === 'error' || state.status === 'invalid-response' ? undefined : <ReportExportButton onExport={onExport} status={exportState.status} />}
      description={t('reports.budgetVsActual.subtitle')}
      testID="budget-vs-actual-report"
      title={t('reports.budgetVsActual.title')}
    >
      {content}
      {state.status === 'loaded' ? <UnconvertedAmountsNote completeness={state.completeness} testID="budget-vs-actual-report-unconverted" /> : null}
    </ReportSection>
  )
}

export function BudgetVsActualScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: BudgetVsActualScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <BudgetVsActualBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

const styles = StyleSheet.create({
  category: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  over: { fontWeight: '500' },
})

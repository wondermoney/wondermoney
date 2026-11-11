import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount, MISSING } from '@/components/ui/amount'
import { SelectTrigger } from '@/components/ui/select-trigger'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { UnconvertedAmountsNote } from '@/components/ui/unconverted-amounts-note'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'

import { formatMonthLabel, monthPickerOptions } from './month-comparison-months'
import type { MonthComparisonReportViewModel } from './month-comparison-report-view-model'
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
  type ReportTableRow,
  useReportCategoryName,
} from './report-screen-parts'
import type { ReportExportState } from './use-report-export'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

export type MonthComparisonReportViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; report: MonthComparisonReportViewModel; refreshing?: boolean; completeness?: AmountsCompleteness }

export type MonthComparisonMonthsState = Readonly<{
  base: string
  compare: string
  setBase: (monthKey: string) => void
  setCompare: (monthKey: string) => void
}>

export type MonthComparisonReportBodyProps = {
  state: MonthComparisonReportViewState
  currencyCode: string
  months: MonthComparisonMonthsState
  exportState: ReportExportState
  onExport: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}

export type MonthComparisonReportScreenProps = MonthComparisonReportBodyProps & {
  preset: ReportDatePreset
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  onSelectPreset: (preset: ReportDatePreset) => void
  onBack: () => void
}

/**
 * Web's `MonthComparisonReport` at phone width: two month pickers, the totals
 * for both months, then one row per category with its change. A list, not a
 * chart — the phone is where the numbers are read one at a time.
 */
export function MonthComparisonReportBody({ state, currencyCode, months, exportState, onExport, onRefresh }: MonthComparisonReportBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const categoryName = useReportCategoryName()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })

  if (state.status === 'access-transition') return null

  const exportAction = <ReportExportButton onExport={onExport} status={exportState.status} />
  const pickers = (
    <View style={styles.pickers}>
      <MonthPickerField label={t('reports.monthComparison.baseMonth')} onChange={months.setBase} value={months.base} />
      <MonthPickerField label={t('reports.monthComparison.compareMonth')} onChange={months.setCompare} value={months.compare} />
    </View>
  )

  let content: React.ReactNode
  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.monthComparison.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else {
    const { report } = state
    const baseLabel = formatMonthLabel(report.base.month, locale)
    const compareLabel = formatMonthLabel(report.compare.month, locale)
    const rate = (value: number | null) => (value === null ? MISSING : new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: 'percent' }).format(value))
    const totalRow = (key: string, label: string, base: number, compare: number, render: (value: number) => React.ReactNode): ReportTableRow => ({
      accessibilityLabel: `${label}, ${baseLabel} ${money(base)}, ${compareLabel} ${money(compare)}`,
      cells: {
        change: render(base - compare),
        compare: render(compare),
        metric: label,
        base: render(base),
      },
      key,
    })

    const totals: ReportTableRow[] = [
      totalRow('income', t('reports.monthComparison.income'), report.base.income, report.compare.income, (value) => <Amount currency={currencyCode} locale={locale} value={value} />),
      totalRow('expenses', t('reports.monthComparison.expenses'), report.base.expenses, report.compare.expenses, (value) => <Amount currency={currencyCode} locale={locale} value={value} />),
      totalRow('net', t('reports.monthComparison.net'), report.base.net, report.compare.net, (value) => <Amount currency={currencyCode} locale={locale} value={value} />),
      {
        accessibilityLabel: `${t('reports.monthComparison.savingsRate')}, ${baseLabel} ${rate(report.base.savingsRate)}, ${compareLabel} ${rate(report.compare.savingsRate)}`,
        cells: {
          change: <Text variant="meta">{report.base.savingsRate === null || report.compare.savingsRate === null ? MISSING : rate(report.base.savingsRate - report.compare.savingsRate)}</Text>,
          compare: <Text variant="meta">{rate(report.compare.savingsRate)}</Text>,
          metric: t('reports.monthComparison.savingsRate'),
          base: <Text variant="meta">{rate(report.base.savingsRate)}</Text>,
        },
        key: 'savings-rate',
      },
    ]

    const categoryRows: ReportTableRow[] = report.rows.map((row) => ({
      accessibilityLabel: `${categoryName(row.name)}, ${baseLabel} ${money(row.base)}, ${compareLabel} ${money(row.compare)}, ${t('reports.monthComparison.change')} ${money(row.delta)}`,
      cells: {
        category: <View style={styles.category}><View style={[styles.dot, { backgroundColor: row.color }]} /><Text numberOfLines={2} variant="meta">{categoryName(row.name)}</Text></View>,
        base: <Amount currency={currencyCode} locale={locale} value={row.base} />,
        compare: <Amount currency={currencyCode} locale={locale} value={row.compare} />,
        change: (
          <View style={styles.change}>
            <Amount currency={currencyCode} delta locale={locale} toneValue={-row.delta} value={row.delta} />
            {row.deltaPct === null ? null : (
              <Text tone="muted" variant="label">{new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: 'percent' }).format(row.deltaPct / 100)}</Text>
            )}
          </View>
        ),
      },
      key: row.key,
    }))

    content = (
      <View style={styles.body}>
        <ReportTable
          columns={[
            { key: 'metric', label: t('reports.monthComparison.metric') },
            { align: 'right', key: 'base', label: baseLabel },
            { align: 'right', key: 'compare', label: compareLabel },
            { align: 'right', key: 'change', label: t('reports.monthComparison.change') },
          ]}
          rows={totals}
          testID="month-comparison-totals"
        />
        {report.rows.length === 0 ? (
          <ReportEmptyState description={t('reports.monthComparison.emptyMessage')} icon="arrow-left-right" title={t('reports.monthComparison.emptyTitle')} />
        ) : (
          <ReportTable
            columns={[
              { key: 'category', label: t('reports.monthComparison.category') },
              { align: 'right', key: 'base', label: baseLabel },
              { align: 'right', key: 'compare', label: compareLabel },
              { align: 'right', key: 'change', label: t('reports.monthComparison.change') },
            ]}
            rows={categoryRows}
            testID="month-comparison-categories"
          />
        )}
      </View>
    )
  }

  return (
    <ReportSection actions={exportAction} description={t('reports.monthComparison.subtitle')} testID="month-comparison-report" title={t('reports.monthComparison.title')}>
      <View style={styles.body}>
        {pickers}
        {content}
      </View>
      {state.status === 'loaded' ? <UnconvertedAmountsNote completeness={state.completeness} testID="month-comparison-report-unconverted" /> : null}
    </ReportSection>
  )
}

export function MonthComparisonReportScreen({ state, preset, currencyCode, months, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: MonthComparisonReportScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <MonthComparisonReportBody currencyCode={currencyCode} exportState={exportState} months={months} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

/** One month as a select trigger that opens the shared option sheet. */
function MonthPickerField({ label, value, onChange }: { label: string; value: string; onChange: (monthKey: string) => void }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const options = monthPickerOptions()
  return (
    <View style={styles.picker}>
      <Text tone="muted" variant="label">{label}</Text>
      <SelectTrigger accessibilityLabel={label} icon="calendar" onPress={() => setOpen(true)} value={formatMonthLabel(value, locale)} />
      <OptionSheet
        dismissLabel={t('common.cancel')}
        onClose={() => setOpen(false)}
        onSelect={(next) => { setOpen(false); onChange(next) }}
        options={options.map((monthKey) => ({ label: formatMonthLabel(monthKey, locale), value: monthKey }))}
        title={label}
        value={value}
        visible={open}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[4] },
  pickers: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  picker: { flex: 1, gap: themeTokens.spacing[1] },
  category: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  change: { alignItems: 'flex-end', gap: 2 },
})

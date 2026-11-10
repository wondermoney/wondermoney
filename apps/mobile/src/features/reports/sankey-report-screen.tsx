import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'

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

/**
 * Web's `SankeyReport` below `sm`: the chart gives way to "This chart is best
 * viewed on a wider screen." and the table of the same links (Source, Target,
 * Value). The total inflow is mobile's own figure; it sits under the table.
 */
export function SankeyReportBody({ state, currencyCode, exportState, onExport, onRefresh }: SankeyReportBodyProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const categoryName = useReportCategoryName()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode })

  if (state.status === 'access-transition') return null

  let content: React.ReactNode
  if (state.status === 'loading') {
    content = <ReportSectionLoading label={t('reports.sankey.loading')} />
  } else if (state.status === 'error' || state.status === 'invalid-response') {
    content = <ReportSectionFailure invalid={state.status === 'invalid-response'} onRetry={onRefresh} />
  } else if (state.report.links.length === 0) {
    content = <ReportEmptyState description={t('reports.sankey.emptyMessage')} icon="arrow-left-right" title={t('reports.sankey.emptyTitle')} />
  } else {
    const { report } = state
    const totalLabel = t('reports.sankey.total', { value: money(report.total) })
    content = (
      <View style={styles.body}>
        <Text tone="muted" variant="meta">{t('reports.sankey.mobileNotice')}</Text>
        <ReportTable
          columns={[
            { key: 'source', label: t('reports.sankey.source') },
            { key: 'target', label: t('reports.sankey.target') },
            { key: 'value', label: t('reports.sankey.value'), align: 'right' },
          ]}
          rows={report.links.map((link) => {
            const source = categoryName(link.sourceLabel)
            const target = categoryName(link.targetLabel)
            return {
              key: link.key,
              accessibilityLabel: `${source} → ${target}, ${money(link.value)}`,
              cells: {
                source,
                target,
                value: <Amount align="right" currency={currencyCode} locale={locale} value={link.value} />,
              },
            }
          })}
        />
        <Text accessible accessibilityLabel={totalLabel} tone="muted" variant="amountSmall">{totalLabel}</Text>
      </View>
    )
  }

  return (
    <ReportSection
      actions={<ReportExportButton onExport={onExport} status={exportState.status} />}
      description={t('reports.sankey.subtitle')}
      testID="sankey-report"
      title={t('reports.sankey.title')}
    >
      {content}
    </ReportSection>
  )
}

export function SankeyReportScreen({ state, preset, currencyCode, filterState, filterOptions, exportState, onSelectPreset, onExport, onRefresh, onBack }: SankeyReportScreenProps) {
  if (state.status === 'access-transition') return null
  return (
    <ReportStandalonePage
      controls={<ReportFiltersBar filterOptions={filterOptions} filterState={filterState} onSelectPreset={onSelectPreset} preset={preset} />}
      onBack={onBack}
      onRefresh={onRefresh}
      refreshing={Boolean(state.status === 'loaded' && state.refreshing)}
    >
      <SankeyReportBody currencyCode={currencyCode} exportState={exportState} onExport={onExport} onRefresh={onRefresh} state={state} />
    </ReportStandalonePage>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[3] },
})

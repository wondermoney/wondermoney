import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { SelectTrigger } from '@/components/ui/select-trigger'
import { OptionSheet } from '@/components/ui/sheet'
import { themeTokens } from '@/theme/tokens'

import { DEFAULT_REPORT_DATE_PRESET, REPORT_DATE_PRESETS, type ReportDatePreset } from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportIconButton } from './report-screen-parts'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

/** Web's preset order in `DateRangePicker` (the default first). */
const PICKER_ORDER: readonly ReportDatePreset[] = ['last3Months', ...REPORT_DATE_PRESETS.filter((preset) => preset !== 'last3Months')]

export type ReportFiltersBarProps = Readonly<{
  preset: ReportDatePreset
  onSelectPreset: (preset: ReportDatePreset) => void
  /** Omitted where the transaction filters don't apply (portfolio performance): the bar is the period only. */
  filterState?: ReturnType<typeof useReportFilters>
  filterOptions?: ReturnType<typeof useReportFilterOptions>
}>

/**
 * Web's `ReportFiltersBar` at phone width: the period select ("Last 3 months ▾"),
 * then at the row's end the "Filters" outline button (it opens the filter
 * sheet) and the icon-only reset. One bar for the whole page.
 */
export function ReportFiltersBar({ preset, onSelectPreset, filterState, filterOptions }: ReportFiltersBarProps) {
  const { t } = useTranslation()
  const [periodOpen, setPeriodOpen] = useState(false)

  const reset = () => {
    filterState?.resetFields()
    onSelectPreset(DEFAULT_REPORT_DATE_PRESET)
  }

  return (
    <View style={styles.bar} testID="report-filters-bar">
      <SelectTrigger
        accessibilityLabel={t('reports.filters.dateRange')}
        icon="calendar"
        onPress={() => setPeriodOpen(true)}
        value={t(`reports.datePresets.${preset}`)}
      />
      {filterState && filterOptions ? (
        <View style={styles.end}>
          <ReportFilterPanel filterOptions={filterOptions} filterState={filterState} />
          <ReportIconButton icon="rotate-ccw" label={t('reports.filters.reset')} onPress={reset} tone="foreground" />
        </View>
      ) : null}
      <ReportPeriodSheet
        onClose={() => setPeriodOpen(false)}
        onSelect={(next) => { onSelectPreset(next); setPeriodOpen(false) }}
        preset={preset}
        visible={periodOpen}
      />
    </View>
  )
}

/** The preset list web's `DateRangePicker` popover leads with, as a bottom sheet of radio rows. */
function ReportPeriodSheet({ visible, preset, onSelect, onClose }: { visible: boolean; preset: ReportDatePreset; onSelect: (preset: ReportDatePreset) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <OptionSheet
      dismissLabel={t('common.cancel')}
      onClose={onClose}
      onSelect={onSelect}
      options={PICKER_ORDER.map((value) => ({ value, label: t(`reports.datePresets.${value}`) }))}
      title={t('reports.filters.dateRange')}
      value={preset}
      visible={visible}
    />
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[3] },
  end: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
})

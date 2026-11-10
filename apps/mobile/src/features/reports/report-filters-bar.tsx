import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { SelectTrigger } from '@/components/ui/select-trigger'
import { OptionSheet, Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { localCalendarDay } from '@/lib/dates/transaction-date'
import { themeTokens } from '@/theme/tokens'

import {
  customReportDateRange,
  DEFAULT_REPORT_DATE_PRESET,
  formatReportDateRange,
  isCustomReportDatePreset,
  REPORT_DATE_PRESETS,
  ReportCustomRangeError,
  type ReportDatePreset,
  type ReportDatePresetName,
  reportPresetDateRange,
  reportPresetKey,
} from './report-date-presets'
import { ReportFilterPanel } from './report-filter-panel'
import { ReportIconButton } from './report-screen-parts'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

/** Web's preset order in `DateRangePicker` (the default first), then the hand-picked range. */
const PICKER_ORDER: readonly ReportDatePresetName[] = ['last3Months', ...REPORT_DATE_PRESETS.filter((preset) => preset !== 'last3Months')]

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
 *
 * The period sheet leads with web's presets and ends with "Custom range", which
 * opens the same two whole-day fields the transactions screen uses. A chosen
 * range is shown in the trigger as "Aug 3, 2026 – Aug 17, 2026".
 */
export function ReportFiltersBar({ preset, onSelectPreset, filterState, filterOptions }: ReportFiltersBarProps) {
  const { t, i18n } = useTranslation()
  const [periodOpen, setPeriodOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState<string | null>(null)
  const [customTo, setCustomTo] = useState<string | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  const reset = () => {
    filterState?.resetFields()
    onSelectPreset(DEFAULT_REPORT_DATE_PRESET)
  }

  // Opening on the days already in force lets the person adjust a range rather than start over.
  const openCustom = () => {
    const range = isCustomReportDatePreset(preset) ? preset : reportPresetDateRange(preset)
    setCustomFrom(localCalendarDay(range.from))
    setCustomTo(localCalendarDay(range.to))
    setCustomError(null)
    setCustomOpen(true)
  }

  const applyCustom = () => {
    try {
      const range = customReportDateRange(customFrom, customTo)
      setCustomError(null)
      setCustomOpen(false)
      onSelectPreset(range)
    } catch (error) {
      const problem = error instanceof ReportCustomRangeError ? error.problem : 'invalid'
      setCustomError(problem === 'order' ? t('reports.filters.customRangeOrder') : t('reports.filters.customRangeInvalid'))
    }
  }

  const label = isCustomReportDatePreset(preset)
    ? formatReportDateRange(preset.from, preset.to, locale)
    : t(`reports.datePresets.${preset}`)

  return (
    <View style={styles.bar} testID="report-filters-bar">
      <SelectTrigger
        accessibilityLabel={t('reports.filters.dateRange')}
        icon="calendar"
        onPress={() => setPeriodOpen(true)}
        value={label}
      />
      {filterState && filterOptions ? (
        <View style={styles.end}>
          <ReportFilterPanel filterOptions={filterOptions} filterState={filterState} />
          <ReportIconButton icon="rotate-ccw" label={t('reports.filters.reset')} onPress={reset} tone="foreground" />
        </View>
      ) : null}
      <ReportPeriodSheet
        onClose={() => setPeriodOpen(false)}
        onSelect={(next) => {
          setPeriodOpen(false)
          if (next === 'custom') openCustom()
          else onSelectPreset(next)
        }}
        preset={preset}
        visible={periodOpen}
      />
      <Sheet
        closeLabel={t('common.cancel')}
        onClose={() => { setCustomOpen(false); setCustomError(null) }}
        title={t('reports.filters.customRange')}
        visible={customOpen}
      >
        <View style={styles.customRange}>
          <View style={styles.dateRow}>
            <View style={styles.dateCell}>
              <DateField
                label={t('reports.filters.customRangeFrom')}
                maximumDate={customTo ?? undefined}
                onChange={setCustomFrom}
                testID="report-custom-from"
                value={customFrom}
              />
            </View>
            <View style={styles.dateCell}>
              <DateField
                label={t('reports.filters.customRangeTo')}
                minimumDate={customFrom ?? undefined}
                onChange={setCustomTo}
                testID="report-custom-to"
                value={customTo}
              />
            </View>
          </View>
          {customError ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{customError}</Text> : null}
          <Button
            block
            disabled={!customFrom || !customTo}
            label={t('reports.filters.customRangeApply')}
            onPress={applyCustom}
          />
        </View>
      </Sheet>
    </View>
  )
}

/** The preset list web's `DateRangePicker` popover leads with, as a bottom sheet of radio rows. */
function ReportPeriodSheet({ visible, preset, onSelect, onClose }: { visible: boolean; preset: ReportDatePreset; onSelect: (preset: ReportDatePresetName | 'custom') => void; onClose: () => void }) {
  const { t } = useTranslation()
  const options = [...PICKER_ORDER, 'custom'] as const
  return (
    <OptionSheet
      dismissLabel={t('common.cancel')}
      onClose={onClose}
      onSelect={onSelect}
      options={options.map((value) => ({
        value,
        label: value === 'custom' ? t('reports.filters.customRange') : t(`reports.datePresets.${value}`),
      }))}
      title={t('reports.filters.dateRange')}
      value={reportPresetKey(preset)}
      visible={visible}
    />
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[3] },
  end: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  customRange: { gap: themeTokens.spacing[4] },
  dateRow: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  dateCell: { flex: 1 },
})

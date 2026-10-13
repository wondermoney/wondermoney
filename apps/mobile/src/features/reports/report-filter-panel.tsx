import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { ReportCurrencyPicker } from './report-currency-picker'
import { ReportMultiSelectPicker } from './report-multi-select-picker'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

export type ReportFilterPanelProps = Readonly<{
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  palette: Palette
}>

/** Shared across all 6 report screens — the account/category/merchant/currency filters and the
 * pending/transfers toggles, collapsed behind a single "Filters" trigger (with an active-count
 * badge) so the date-preset bar stays the primary, always-visible control. */
export function ReportFilterPanel({ filterState, filterOptions, palette }: ReportFilterPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { fields, activeFilterCount, setAccountKeys, setCategoryKeys, setMerchantKeys, setCurrencyKey, setIncludePending, setIncludeTransfers, resetFields } = filterState

  const triggerLabel = t('reports.filters.openLabel', { suffix: activeFilterCount > 0 ? t('reports.filters.activeCount', { count: activeFilterCount }) : '' })

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.trigger, { borderColor: palette.border, backgroundColor: palette.card }]}
      >
        <Text allowFontScaling style={[styles.triggerText, { color: palette.foreground }]}>{t('reports.filters.title')}</Text>
        {activeFilterCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: palette.primary }]}>
            <Text allowFontScaling style={[styles.badgeText, { color: palette.background }]}>{activeFilterCount}</Text>
          </View>
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={[styles.panel, { borderColor: palette.border, backgroundColor: palette.muted }]}>
          <ReportMultiSelectPicker label={t('reports.filters.accounts')} options={filterOptions.accounts} selected={fields.accountKeys} onChange={setAccountKeys} palette={palette} />
          <ReportMultiSelectPicker label={t('reports.filters.categories')} options={filterOptions.categories} selected={fields.categoryKeys} onChange={setCategoryKeys} palette={palette} />
          <ReportMultiSelectPicker label={t('reports.filters.merchants')} options={filterOptions.merchants} selected={fields.merchantKeys} onChange={setMerchantKeys} palette={palette} />
          <ReportCurrencyPicker currencies={filterOptions.currencies} selected={fields.currencyKey} onChange={setCurrencyKey} palette={palette} />

          <ReportFilterToggle label={t('reports.filters.includePending')} value={fields.includePending} onToggle={setIncludePending} palette={palette} />
          <ReportFilterToggle label={t('reports.filters.includeTransfers')} value={fields.includeTransfers} onToggle={setIncludeTransfers} palette={palette} />

          <Pressable accessibilityRole="button" onPress={resetFields} style={styles.resetRow}>
            <Text allowFontScaling style={[styles.resetText, { color: palette.primary }]}>{t('reports.filters.reset')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function ReportFilterToggle({ label, value, onToggle, palette }: { label: string; value: boolean; onToggle: (next: boolean) => void; palette: Palette }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onToggle(!value)}
      style={styles.toggleRow}
    >
      <View style={[styles.checkbox, { borderColor: palette.primary }, value && { backgroundColor: palette.primary }]} />
      <Text allowFontScaling style={[styles.toggleLabel, { color: palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { gap: themeTokens.spacing[3] },
  trigger: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] },
  triggerText: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { ...textStyles.amountSmall },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] },
  toggleRow: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  checkbox: { width: 20, height: 20, borderWidth: 1.5, borderRadius: themeTokens.radius.sm },
  toggleLabel: { ...textStyles.body, flex: 1 },
  resetRow: { minHeight: themeTokens.touchTarget.minimum, alignSelf: 'flex-start', justifyContent: 'center' },
  resetText: { ...textStyles.bodyStrong, fontWeight: '600' as const },
})

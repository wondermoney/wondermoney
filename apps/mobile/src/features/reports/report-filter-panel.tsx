import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { ReportCurrencyPicker } from './report-currency-picker'
import { Icon } from '@/components/ui/icon'
import { ReportMultiSelectPicker } from './report-multi-select-picker'
import { ReportIconButton } from './report-screen-parts'
import type { useReportFilterOptions } from './use-report-filter-options'
import type { useReportFilters } from './use-report-filters'

export type ReportFilterPanelProps = Readonly<{
  filterState: ReturnType<typeof useReportFilters>
  filterOptions: ReturnType<typeof useReportFilterOptions>
  /** @deprecated read from the colour scheme; accepted so older call sites compile. */
  palette?: Palette
}>

/**
 * Web's "Filters" outline button and the sheet it opens (`ReportFiltersBar`):
 * one labelled control per row — accounts, categories, merchants, currency —
 * then the pending/transfers checkboxes. The reset lives on the bar, beside
 * the trigger, as on web.
 */
export function ReportFilterPanel({ filterState, filterOptions }: ReportFilterPanelProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [open, setOpen] = useState(false)
  const { fields, activeFilterCount, setAccountKeys, setCategoryKeys, setMerchantKeys, setCurrencyKey, setIncludePending, setIncludeTransfers } = filterState

  const triggerLabel = t('reports.filters.openLabel', { suffix: activeFilterCount > 0 ? t('reports.filters.activeCount', { count: activeFilterCount }) : '' })
  const title = t('reports.filters.title')

  return (
    <>
      <Button
        accessibilityLabel={triggerLabel}
        icon="filter"
        count={activeFilterCount}
        label={title}
        onPress={() => setOpen(true)}
        variant="outline"
      />
      <Modal animationType="slide" onRequestClose={() => setOpen(false)} presentationStyle="pageSheet" visible={open}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={[styles.sheetHead, { borderBottomColor: palette.border }]}>
            <Text accessibilityRole="header" variant="section">{title}</Text>
            <ReportIconButton icon="x" label={t('reports.filters.close')} onPress={() => setOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <View style={styles.fields}>
              <ReportMultiSelectPicker label={t('reports.filters.accounts')} options={filterOptions.accounts} selected={fields.accountKeys} onChange={setAccountKeys} palette={palette} />
              <ReportMultiSelectPicker label={t('reports.filters.categories')} options={filterOptions.categories} selected={fields.categoryKeys} onChange={setCategoryKeys} palette={palette} />
              <ReportMultiSelectPicker label={t('reports.filters.merchants')} options={filterOptions.merchants} selected={fields.merchantKeys} onChange={setMerchantKeys} palette={palette} />
              <ReportCurrencyPicker currencies={filterOptions.currencies} selected={fields.currencyKey} onChange={setCurrencyKey} palette={palette} />
            </View>
            <View style={styles.toggles}>
              <ReportFilterToggle label={t('reports.filters.includePending')} value={fields.includePending} onToggle={setIncludePending} />
              <ReportFilterToggle label={t('reports.filters.includeTransfers')} value={fields.includeTransfers} onToggle={setIncludeTransfers} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

/** Web's `Checkbox` + label: a 16pt input-stroke square, filled primary with a check when on. */
function ReportFilterToggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: (next: boolean) => void }) {
  const palette = usePalette()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onToggle(!value)}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
    >
      <View style={[styles.checkbox, { borderColor: value ? palette.primary : palette.input, backgroundColor: value ? palette.primary : 'transparent' }]}>
        {value ? <Icon color={palette.primaryForeground} name="check" size={12} /> : null}
      </View>
      <Text style={styles.toggleLabel} variant="meta">{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: themeTokens.layout.screenPadding,
    paddingVertical: themeTokens.spacing[3],
    borderBottomWidth: 1,
  },
  sheetBody: { padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  fields: { gap: themeTokens.spacing[4] },
  toggles: { gap: themeTokens.spacing[1] },
  toggleRow: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  checkbox: { width: 16, height: 16, borderWidth: 1, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  toggleLabel: { flex: 1 },
  pressed: { opacity: 0.72 },
})

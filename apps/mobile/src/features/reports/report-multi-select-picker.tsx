import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { ReportFilterOption } from './report-filter-options'

export type ReportMultiSelectPickerProps = Readonly<{
  label: string
  options: readonly ReportFilterOption[]
  selected: readonly string[]
  onChange: (selected: readonly string[]) => void
  palette: Palette
}>

const MAX_VISIBLE_RESULTS = 50

/** Same searchable/capped-list shape as markets' CanonicalValuePicker, adapted for multi-select
 * (checkbox rows, toggling membership in `selected` rather than replacing a single value). Used
 * for the reports account/category/merchant filters — each list can run from a handful of entries
 * to hundreds of merchants. */
export function ReportMultiSelectPicker({ label, options, selected, onChange, palette }: ReportMultiSelectPickerProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    const matches = trimmed === '' ? options : options.filter((option) => option.label.toLowerCase().includes(trimmed))
    return matches.slice(0, MAX_VISIBLE_RESULTS)
  }, [options, query])

  const summary = selected.length === 0
    ? t('reports.filters.placeholderAny')
    : t('reports.filters.selectedCount', { count: selected.length })

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id])
  }

  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${summary}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.card }]}
      >
        <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{label}</Text>
        <Text allowFontScaling style={[styles.summaryValue, { color: selected.length > 0 ? palette.foreground : palette.mutedForeground }]}>{summary}</Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.panel, { borderColor: palette.border, backgroundColor: palette.card }]}>
          {selected.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => onChange([])} style={styles.clearRow}>
              <Text allowFontScaling style={[styles.clearLabel, { color: palette.primary }]}>{t('reports.filters.clearAll')}</Text>
            </Pressable>
          ) : null}
          <TextInput
            accessibilityLabel={t('reports.filters.searchPlaceholder', { label })}
            onChangeText={setQuery}
            placeholder={t('reports.filters.searchPlaceholder', { label })}
            placeholderTextColor={palette.mutedForeground}
            style={[styles.search, { color: palette.foreground, borderColor: palette.border }]}
            value={query}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={item.label}
                accessibilityState={{ checked: selectedSet.has(item.id) }}
                onPress={() => toggle(item.id)}
                style={styles.optionRow}
              >
                <View style={[styles.checkbox, { borderColor: palette.primary }, selectedSet.has(item.id) && { backgroundColor: palette.primary }]} />
                <Text allowFontScaling style={[styles.optionLabel, { color: palette.foreground }]}>{item.label}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground }]}>{t('reports.filters.noResults')}</Text>}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  summary: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2], gap: themeTokens.spacing[1] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  summaryValue: { ...textStyles.body },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3], gap: themeTokens.spacing[2], maxHeight: 320 },
  clearRow: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center' },
  clearLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  search: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.sm, paddingHorizontal: themeTokens.spacing[3] },
  list: { flexGrow: 0 },
  optionRow: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[1] },
  checkbox: { width: 20, height: 20, borderWidth: 1.5, borderRadius: themeTokens.radius.sm },
  optionLabel: { ...textStyles.body, flex: 1 },
  empty: { ...textStyles.body, paddingVertical: themeTokens.spacing[2] },
})

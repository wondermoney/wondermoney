import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'


export type CanonicalValuePickerProps = Readonly<{
  label: string
  options: readonly string[]
  selected: string | null
  onSelect: (value: string | null) => void
  palette: Palette
}>

const MAX_VISIBLE_RESULTS = 50

/**
 * Reused across sector/industry/country/exchange (screener-canonical-lists.ts) — lists run from
 * 7 to 219 entries, so this is search-filterable and results are capped rather than rendering
 * every match, keeping the list responsive without pulling in a virtualization dependency beyond
 * FlatList (already part of react-native core).
 */
export function CanonicalValuePicker({ label, options, selected, onSelect, palette }: CanonicalValuePickerProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    const matches = trimmed === '' ? options : options.filter((option) => option.toLowerCase().includes(trimmed))
    return matches.slice(0, MAX_VISIBLE_RESULTS)
  }, [options, query])

  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.card }]}
      >
        <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{label}</Text>
        <Text allowFontScaling style={[styles.summaryValue, { color: selected ? palette.foreground : palette.mutedForeground }]}>
          {selected ?? t('screener.canonicalPicker.any')}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.panel, { borderColor: palette.border, backgroundColor: palette.card }]}>
          {selected ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => { onSelect(null); setExpanded(false); setQuery('') }}
              style={styles.clearRow}
            >
              <Text allowFontScaling style={[styles.clearLabel, { color: palette.primary }]}>{t('screener.canonicalPicker.clear')}</Text>
            </Pressable>
          ) : null}
          <TextInput
            accessibilityLabel={t('screener.canonicalPicker.searchPlaceholder', { label })}
            onChangeText={setQuery}
            placeholder={t('screener.canonicalPicker.searchPlaceholder', { label })}
            placeholderTextColor={palette.mutedForeground}
            style={[styles.search, { color: palette.foreground, borderColor: palette.border }]}
            value={query}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item === selected }}
                onPress={() => { onSelect(item); setExpanded(false); setQuery('') }}
                style={styles.optionRow}
              >
                <Text allowFontScaling style={[styles.optionLabel, { color: item === selected ? palette.primary : palette.foreground }]}>{item}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground }]}>{t('screener.canonicalPicker.noMatches')}</Text>}
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
  optionRow: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', paddingHorizontal: themeTokens.spacing[1] },
  optionLabel: { ...textStyles.body },
  empty: { ...textStyles.body, paddingVertical: themeTokens.spacing[2] },
})

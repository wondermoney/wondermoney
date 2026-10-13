import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import type { TickerSearchResultDto } from '@/features/markets/markets-contract'
import { useTickerSearch } from '@/features/markets/use-ticker-search'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioPalette } from './portfolio-form-parts'

export type PortfolioTickerSearchFieldProps = Readonly<{
  label: string
  palette: PortfolioPalette
  onSelect: (result: TickerSearchResultDto) => void
  disabled?: boolean
}>

/**
 * Shared ticker-search widget: wraps markets' useTickerSearch (the only ticker search already
 * shipped on mobile) in a self-contained text field + results list so both the CSV-import asset
 * review step (RAD-514) and manual transaction creation (RAD-516) can search for a security
 * without each building its own autocomplete.
 */
export function PortfolioTickerSearchField({ label, palette, onSelect, disabled = false }: PortfolioTickerSearchFieldProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const search = useTickerSearch(query)
  const trimmed = query.trim()
  const results = search.data?.results ?? []

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        placeholder={t('portfolioTickerSearch.placeholder')}
        placeholderTextColor={palette.mutedForeground}
        style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
      />
      {trimmed.length > 0 && search.isFetching ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('portfolioTickerSearch.searching')} style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('portfolioTickerSearch.searching')}
        </Text>
      ) : null}
      {trimmed.length > 0 && !search.isFetching && results.length === 0 ? (
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioTickerSearch.noResults')}</Text>
      ) : null}
      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((result) => (
            <Pressable
              key={`${result.symbol}-${result.exchange ?? ''}`}
              accessibilityRole="button"
              accessibilityLabel={[result.name, result.symbol, result.exchange].filter(Boolean).join(', ')}
              disabled={disabled}
              onPress={() => { setQuery(''); onSelect(result) }}
              style={({ pressed }) => [styles.result, { borderColor: palette.border }, (pressed || disabled) && styles.pressed]}
            >
              <Text style={[styles.resultSymbol, { color: palette.foreground }]}>{result.symbol}{result.exchange ? ` · ${result.exchange}` : ''}</Text>
              {result.name ? <Text style={[styles.resultName, { color: palette.mutedForeground }]}>{result.name}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  helper: { ...textStyles.meta },
  results: { gap: themeTokens.spacing[1] },
  result: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2], justifyContent: 'center', gap: 2 },
  resultSymbol: { ...textStyles.amount },
  resultName: { ...textStyles.meta },
  pressed: { opacity: 0.72 },
})

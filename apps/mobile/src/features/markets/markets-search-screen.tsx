import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { MarketsAction, MarketsFailure, marketsStyles, type Palette } from './markets-screen-parts'
import type { SearchResultRow } from './markets-view-model'

export type MarketsSearchScreenState =
  | { status: 'access-transition' }
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'loaded'; rows: readonly SearchResultRow[] }

export type MarketsSearchScreenProps = {
  state: MarketsSearchScreenState
  query: string
  onQueryChange: (value: string) => void
  onSelectSymbol: (symbol: string) => void
  onBack: () => void
  onOpenWatchlist: () => void
  onOpenScreener: () => void
}

export function MarketsSearchScreen({ state, query, onQueryChange, onSelectSymbol, onBack, onOpenWatchlist, onOpenScreener }: MarketsSearchScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const insets = useContext(SafeAreaInsetsContext)

  if (state.status === 'access-transition') return null

  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <MarketsFailure
        title={t(invalid ? 'marketsSearch.invalidResponse.title' : 'marketsSearch.error.title')}
        message={t(invalid ? 'marketsSearch.invalidResponse.message' : 'marketsSearch.error.message')}
        backLabel={t('marketsSearch.back')}
        retryLabel={t('common.retry')}
        onBack={onBack}
        onRetry={onBack}
        palette={palette}
        retryable={false}
      />
    )
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[marketsStyles.content, { paddingTop: themeTokens.spacing[6] + (insets?.top ?? 0) }]} keyboardShouldPersistTaps="handled">
        <View style={marketsStyles.page}>
          <View style={headingStyles.headerRow}>
            <BackControl fallback="/more" label={t('marketsSearch.back')} onPress={onBack} />
            <MarketsAction label={t('marketsSearch.watchlistLink')} onPress={onOpenWatchlist} palette={palette} />
            <MarketsAction label={t('marketsSearch.screenerLink')} onPress={onOpenScreener} palette={palette} />
          </View>

          <PageHeader palette={palette} title={t('marketsSearch.title')} />

          <TextInput
            accessibilityLabel={t('marketsSearch.searchLabel')}
            placeholder={t('marketsSearch.placeholder')}
            placeholderTextColor={palette.mutedForeground}
            value={query}
            onChangeText={onQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            style={[headingStyles.search, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
          />

          {state.status === 'loading' ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={t('marketsSearch.loading')} style={headingStyles.loading}>
              <View style={[headingStyles.skeleton, { width: 260, height: 20, backgroundColor: palette.muted }]} />
              <View style={[headingStyles.skeleton, { width: 320, height: 20, backgroundColor: palette.muted }]} />
            </View>
          ) : null}


           {state.status === 'empty' ? (
             <View style={headingStyles.emptyGroup}>
               <Text allowFontScaling style={[headingStyles.emptyTitle, { color: palette.foreground }]}>{t('marketsSearch.emptyTitle')}</Text>
               <Text allowFontScaling style={[headingStyles.empty, { color: palette.mutedForeground }]}>{t('marketsSearch.empty', { term: query })}</Text>
               <MarketsAction label={t('marketsSearch.screenerLink')} onPress={onOpenScreener} palette={palette} primary />
             </View>
          ) : null}

          {state.status === 'loaded' ? (
            <View style={marketsStyles.list}>
              {state.rows.map((row, index) => (
                <SearchResultRowView
                  key={`${row.symbol}-${index}`}
                  row={row}
                  palette={palette}
                  separated={index > 0}
                  onPress={() => onSelectSymbol(row.symbol)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function SearchResultRowView({ row, palette, separated, onPress }: {
  row: SearchResultRow
  palette: Palette
  separated: boolean
  onPress: () => void
}) {
  const label = [row.name, row.symbol, row.exchange].filter(Boolean).join(', ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        headingStyles.row,
        { borderColor: palette.border },
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        pressed && headingStyles.pressed,
      ]}
    >
      {row.name ? (
        <Text allowFontScaling style={[headingStyles.rowName, { color: palette.foreground }]}>{row.name}</Text>
      ) : null}
      <Text allowFontScaling style={[headingStyles.rowSymbol, { color: row.name ? palette.mutedForeground : palette.foreground }]}>
        {row.symbol}{row.exchange ? ` · ${row.exchange}` : ''}
      </Text>
    </Pressable>
  )
}

const headingStyles = StyleSheet.create({
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  search: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { borderRadius: themeTokens.radius.sm },
  empty: { ...textStyles.body },
  emptyGroup: { gap: themeTokens.spacing[2] }, emptyTitle: { ...textStyles.section },
  row: {
    width: '100%',
    minHeight: themeTokens.touchTarget.minimum,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[1],
    justifyContent: 'center',
  },
  rowName: { ...textStyles.section },
  rowSymbol: { ...textStyles.amountSmall },
  pressed: { opacity: 0.72 },
})

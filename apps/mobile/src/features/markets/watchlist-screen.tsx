import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { formatCurrency, formatPercentagePoints } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { MarketsFailure, MarketsLoading, marketsStyles, type Palette } from './markets-screen-parts'
import { signPrefix, type WatchlistRow } from './markets-view-model'

export type WatchlistScreenState =
  | { status: 'access-transition' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'empty' }
  | { status: 'loaded'; rows: readonly WatchlistRow[] }

export type WatchlistScreenProps = {
  state: WatchlistScreenState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onSelectSymbol: (symbol: string) => void
  onRemove: (symbol: string) => void
  /** The symbol whose remove mutation is currently in flight, or null if none is. */
  removingSymbol: string | null
}

export function WatchlistScreen({ state, onBack, onRetry, onSelectSymbol, onRemove, removingSymbol }: WatchlistScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return <MarketsLoading label={t('watchlist.loading')} palette={palette} backLabel={t('watchlist.back')} onBack={onBack} />
  }

  if (state.status === 'error' || state.status === 'invalid-response') {
    const key = state.status === 'invalid-response' ? 'invalidResponse' : 'error'
    return (
      <MarketsFailure
        title={t(`watchlist.${key}.title`)}
        message={t(`watchlist.${key}.message`)}
        backLabel={t('watchlist.back')}
        retryLabel={t('common.retry')}
        onBack={onBack}
        onRetry={onRetry}
        palette={palette}
      />
    )
  }

  return (
    <SafeAreaView style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={marketsStyles.content}>
        <View style={marketsStyles.page}>
          <BackControl fallback="/more" label={t('watchlist.back')} onPress={onBack} />

          <PageHeader palette={palette} title={t('watchlist.title')} />

          {state.status === 'empty' ? (
            <View style={headingStyles.emptyGroup}>
              <Text allowFontScaling style={[headingStyles.emptyTitle, { color: palette.foreground }]}>
                {t('watchlist.empty.title')}
              </Text>
              <Text allowFontScaling style={[headingStyles.empty, { color: palette.mutedForeground }]}>
                {t('watchlist.empty.message')}
              </Text>
              <Button label={t('watchlist.empty.searchAction')} onPress={onBack} palette={palette} variant="primary" />
            </View>
          ) : null}

          {state.status === 'loaded' ? (
            <View style={marketsStyles.list}>
              {state.rows.map((row, index) => (
                <WatchlistRowView
                  key={row.symbol}
                  row={row}
                  palette={palette}
                  locale={locale}
                  separated={index > 0}
                  removing={removingSymbol === row.symbol}
                  onPress={() => onSelectSymbol(row.symbol)}
                  onRemove={() => onRemove(row.symbol)}
                  t={t}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function WatchlistRowView({ row, palette, locale, separated, removing, onPress, onRemove, t }: {
  row: WatchlistRow
  palette: Palette
  locale: string
  separated: boolean
  removing: boolean
  onPress: () => void
  onRemove: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const priceText = row.quoteStatus === 'loaded' && row.quote
    ? (row.quote.price === null || row.quote.currency === null
      ? null
      : formatCurrency(row.quote.price, { locale, currency: row.quote.currency }))
    : row.quoteStatus === 'error'
      ? t('watchlist.quoteUnavailable')
      : null
  const changeText = row.quoteStatus === 'loaded' && row.quote && row.quote.change !== null && row.quote.currency !== null
    ? `${signPrefix(row.quote.change)}${formatCurrency(row.quote.change, { locale, currency: row.quote.currency })}${
      row.quote.changePercent === null ? '' : ` (${formatPercentagePoints(row.quote.changePercent, locale, { maximumFractionDigits: 2 })})`
    }`
    : null
  const tone = row.quoteStatus === 'loaded' && row.quote && row.quote.change !== null
    ? (row.quote.change > 0 ? palette.successText : row.quote.change < 0 ? palette.destructiveText : palette.foreground)
    : palette.mutedForeground
  const label = [row.symbol, priceText, changeText].filter(Boolean).join(', ')

  return (
    <View
      testID={`watchlist-row-${row.symbol}`}
      style={[rowStyles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [rowStyles.content, pressed && rowStyles.pressed]}
      >
        <Text allowFontScaling style={[rowStyles.symbol, { color: palette.foreground }]}>{row.symbol}</Text>
        {priceText ? <Text allowFontScaling style={[rowStyles.price, { color: palette.foreground }]}>{priceText}</Text> : null}
        {changeText ? <Text allowFontScaling style={[rowStyles.change, { color: tone }]}>{changeText}</Text> : null}
      </Pressable>
      <Button
        disabled={removing}
        label={removing ? t('watchlist.removing') : t('watchlist.removeAction')}
        onPress={onRemove}
        palette={palette}
        variant="secondary"
      />
    </View>
  )
}

const headingStyles = StyleSheet.create({
  emptyGroup: { gap: themeTokens.spacing[2] },
  emptyTitle: { ...textStyles.section },
  empty: { ...textStyles.body },
})

const rowStyles = StyleSheet.create({
  row: {
    width: '100%',
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  content: { flex: 1, gap: themeTokens.spacing[1] },
  pressed: { opacity: 0.72 },
  symbol: { ...textStyles.amount },
  price: { ...textStyles.amount },
  change: { ...textStyles.amountSmall },
})

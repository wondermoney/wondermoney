import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatPercentagePoints } from '@/lib/formatters/financial'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { MarketsFailure, MarketsLoading, marketsStyles } from './markets-screen-parts'
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
  /** Web's empty state "Go to Explorer". Falls back to `onBack` when not supplied. */
  onOpenExplorer?: () => void
  onRetry: () => void | Promise<void>
  onSelectSymbol: (symbol: string) => void
  onRemove: (symbol: string) => void
  /** The symbol whose remove mutation is currently in flight, or null if none is. */
  removingSymbol: string | null
}

/**
 * Web's `FinancialMarketsWatchlist`: the title and its description, then the
 * rows — the ticker's mark, symbol (16/500) and name (14 muted), the price with
 * its day change, and a filled star that removes the ticker.
 */
export function WatchlistScreen({ state, onBack, onOpenExplorer, onRetry, onSelectSymbol, onRemove, removingSymbol }: WatchlistScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

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
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={marketsStyles.content}>
        <View style={marketsStyles.page}>
          <PageHeader description={t('watchlist.description')} title={t('navigation.watchlist')} />

          {state.status === 'empty' ? (
            <View style={styles.emptyGroup}>
              <Text variant="bodyStrong">{t('watchlist.empty.title')}</Text>
              <Text style={styles.emptyMessage} tone="muted" variant="meta">{t('watchlist.empty.message')}</Text>
              <Button label={t('watchlist.empty.searchAction')} onPress={onOpenExplorer ?? onBack} variant="primary" />
            </View>
          ) : null}

          {state.status === 'loaded' ? (
            <View style={styles.list}>
              {state.rows.map((row, index) => (
                <WatchlistRowView
                  key={row.symbol}
                  row={row}
                  separated={index > 0}
                  removing={removingSymbol === row.symbol}
                  onPress={() => onSelectSymbol(row.symbol)}
                  onRemove={() => onRemove(row.symbol)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function WatchlistRowView({ row, separated, removing, onPress, onRemove }: {
  row: WatchlistRow
  separated: boolean
  removing: boolean
  onPress: () => void
  onRemove: () => void
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [focused, setFocused] = useState(false)
  const formatMoney = useFormatMoney()
  const quote = row.quoteStatus === 'loaded' ? row.quote : null
  // In the listing's currency; with none known (null), the bare number rather than a guessed symbol.
  const money = (value: number) => formatMoney(value, { locale, currency: quote?.currency ?? null })
  const priceText = quote && quote.price !== null ? money(quote.price) : null
  const changeText = quote && quote.change !== null
    ? `${signPrefix(quote.change)}${money(quote.change)}${quote.changePercent === null ? '' : ` (${formatPercentagePoints(quote.changePercent, locale, { maximumFractionDigits: 2 })})`}`
    : null
  // Web shows the day change as a signed percentage beside a "1D" period label.
  const dayChange = quote && quote.changePercent !== null
    ? formatPercentagePoints(quote.changePercent, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : quote && quote.change !== null ? `${signPrefix(quote.change)}${money(quote.change)}` : null
  const direction = quote?.changePercent ?? quote?.change ?? 0
  const changeTone = direction > 0 ? 'success' : direction < 0 ? 'destructive' : 'muted'
  const noLiveQuote = quote !== null && quote.price === null && quote.change === null
  const label = [row.symbol, quote?.name ?? null, priceText, changeText, row.quoteStatus === 'error' ? t('watchlist.marketDataUnavailable') : null].filter(Boolean).join(', ')

  return (
    <View
      testID={`watchlist-row-${row.symbol}`}
      style={[styles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onPress}
        style={({ pressed }) => [styles.identity, focused && [styles.focused, { borderColor: palette.ring }], pressed && styles.pressed]}
      >
        <EntityMark {...assetMark(row.symbol, row.logoUrl)} testID={`watchlist-mark-${row.symbol}`} />
        <View style={styles.identityText}>
          <Text numberOfLines={1} variant="bodyStrong">{row.symbol}</Text>
          <Text numberOfLines={1} tone="muted" variant="meta">{quote?.name ?? '—'}</Text>
        </View>
      </Pressable>

      <View style={styles.quote}>
        {row.quoteStatus === 'loading' ? (
          <ActivityIndicator accessibilityLabel={t('watchlist.loading')} color={palette.primary} size="small" />
        ) : row.quoteStatus === 'error' ? (
          <Text tone="muted" variant="meta">{t('watchlist.marketDataUnavailable')}</Text>
        ) : noLiveQuote ? (
          <Text tone="muted" variant="meta">{t('watchlist.liveQuoteUnavailable')}</Text>
        ) : (
          <>
            <Text align="right" tone={priceText ? 'default' : 'muted'} variant="amountBase">{priceText ?? '—'}</Text>
            {dayChange ? (
              <View style={styles.change}>
                <Text tone="muted" variant="meta">{t('watchlist.period1d')}</Text>
                <Text accessibilityLabel={`${t('watchlist.changeDay')}: ${dayChange}`} tone={changeTone} variant="amount">{dayChange}</Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      <Button
        icon="star-filled"
        label={t('watchlist.remove', { symbol: row.symbol })}
        loading={removing}
        onPress={onRemove}
        size="icon"
        variant="ghost"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Flat rows with hairlines between them; no rule above the list.
  list: { width: '100%' },
  emptyGroup: { alignItems: 'flex-start', gap: themeTokens.spacing[3] },
  emptyMessage: { maxWidth: 384 },
  row: {
    width: '100%',
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[3],
  },
  identity: { flex: 1, minWidth: 0, minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  pressed: { opacity: 0.72 },
  focused: { borderWidth: 2, borderRadius: themeTokens.radius.md },
  quote: { alignItems: 'flex-end', flexShrink: 0, maxWidth: '45%' },
  change: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[1] },
})

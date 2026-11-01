import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { ObjectHeader } from '@/components/ui/page-header'
import { formatCurrency, formatPercentagePoints } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { AssetPriceChart, type AssetPriceChartProps } from './asset-price-chart'
import { formatAsOfTimestamp, signPrefix, type QuoteViewModel } from './markets-view-model'
import { MarketsFailure, MarketsLoading, marketsStyles, ReadOnlyField } from './markets-screen-parts'
import { TickerEarningsPanel, type TickerEarningsState } from './ticker-earnings-panel'
import { TickerFinancialsPanel, type TickerFinancialsState } from './ticker-financials-panel'
import { TickerFundamentalsPanel, type TickerFundamentalsState } from './ticker-fundamentals-panel'

export type AssetDetailViewState =
  | { status: 'invalid-id' }
  | { status: 'access-transition' }
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'loaded'; data: QuoteViewModel }
  | { status: 'refresh-error'; data: QuoteViewModel }

/**
 * Orthogonal to `AssetDetailViewState` on purpose: the
 * watchlist membership `GET` and the quote `GET` are independent requests,
 * so a still-loading or errored watchlist query must never force the whole
 * screen into a loading/error state. 'unknown' hides the toggle rather than
 * guessing a label for it.
 */
export type WatchlistToggleState =
  | { status: 'unknown' }
  | { status: 'known'; isWatchlisted: boolean }

export type AssetDetailScreenProps = {
  state: AssetDetailViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  watchlistToggle: WatchlistToggleState
  onToggleWatchlist: () => void
  isTogglingWatchlist: boolean
  priceChart: Omit<AssetPriceChartProps, 'palette'>
  fundamentals: TickerFundamentalsState
  financials: TickerFinancialsState
  earnings: TickerEarningsState
}

export function AssetDetailScreen({ state, onBack, onRetry, watchlistToggle, onToggleWatchlist, isTogglingWatchlist, priceChart, fundamentals, financials, earnings }: AssetDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const insets = useContext(SafeAreaInsetsContext)

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <MarketsLoading label={t('assetDetail.loading')} palette={palette} backLabel={t('assetDetail.back')} onBack={onBack} />
  }

  if (state.status === 'not-found' || state.status === 'invalid-id' || state.status === 'error' || state.status === 'invalid-response') {
    const key = state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : state.status === 'invalid-response' ? 'invalidResponse' : 'error'
    return (
      <MarketsFailure
        title={t(`assetDetail.${key}.title`)}
        message={t(`assetDetail.${key}.message`)}
        backLabel={t('assetDetail.back')}
        retryLabel={t('common.retry')}
        onBack={onBack}
        onRetry={onRetry}
        palette={palette}
        retryable={state.status === 'error' || state.status === 'invalid-response'}
      />
    )
  }

  const unavailable = t('assetDetail.unavailable')
  const { data } = state
  const amount = (value: number) => (data.currency
    ? formatCurrency(value, { locale, currency: data.currency })
    : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value))
  const priceText = data.price === null ? unavailable : amount(data.price)
  const changeText = data.change === null
    ? unavailable
    : `${signPrefix(data.change)}${amount(data.change)}${data.changePercent === null ? '' : ` (${formatPercentagePoints(data.changePercent, locale, { maximumFractionDigits: 2 })})`}`
  const volumeText = data.volume === null ? unavailable : new Intl.NumberFormat(locale).format(data.volume)
  const marketStateText = t(`assetDetail.marketStates.${data.marketState ?? 'unknown'}`)
  const asOfText = t('assetDetail.asOf', { date: formatAsOfTimestamp(data.source.asOf, locale, unavailable) })

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[marketsStyles.content, { paddingTop: themeTokens.spacing[6] + (insets?.top ?? 0) }]}>
        <View style={marketsStyles.page}>
          <View style={styles.headerRow}>
            <BackControl fallback="/more" label={t('assetDetail.back')} onPress={onBack} />
            {watchlistToggle.status === 'known' ? (
              <Button
                disabled={isTogglingWatchlist}
                label={isTogglingWatchlist
                  ? t('watchlist.toggle.pending')
                  : t(watchlistToggle.isWatchlisted ? 'watchlist.toggle.remove' : 'watchlist.toggle.add')}
                onPress={onToggleWatchlist}
                palette={palette}
                variant="secondary"
              />
            ) : null}
          </View>

          {state.status === 'refresh-error' ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>
              {t('assetDetail.error.message')}
            </Text>
          ) : null}

          <ObjectHeader descriptor={data.name ?? undefined} title={data.symbol} />

          <View style={[marketsStyles.list, { borderColor: palette.border }]}>
            <ReadOnlyField label={t('assetDetail.price')} value={priceText} palette={palette} />
            <ReadOnlyField
              label={t('assetDetail.change')}
              value={changeText}
              palette={palette}
              separated
              tone={data.change === null ? 'muted' : data.change > 0 ? 'positive' : data.change < 0 ? 'negative' : 'default'}
            />
            <ReadOnlyField label={t('assetDetail.volume')} value={volumeText} palette={palette} separated />
            <ReadOnlyField label={t('assetDetail.marketState')} value={marketStateText} palette={palette} separated />
          </View>

          <AssetPriceChart {...priceChart} palette={palette} />

          <TickerFundamentalsPanel state={fundamentals} currency={data.currency} palette={palette} />

          <TickerFinancialsPanel state={financials} palette={palette} />

          <TickerEarningsPanel state={earnings} palette={palette} />

          <Text allowFontScaling style={[styles.asOf, { color: palette.mutedForeground }]}>{asOfText}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  asOf: { ...textStyles.meta },
})

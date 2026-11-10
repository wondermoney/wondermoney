import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { ObjectHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { formatPercentagePoints } from '@/lib/formatters/financial'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

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
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

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
  const amount = (value: number) => formatMoney(value, { locale, currency: data.currency ?? null })
  const priceText = data.price === null ? unavailable : amount(data.price)
  const changeText = data.change === null
    ? unavailable
    : `${signPrefix(data.change)}${amount(data.change)}${data.changePercent === null ? '' : ` (${formatPercentagePoints(data.changePercent, locale, { maximumFractionDigits: 2 })})`}`
  const changePercentText = data.changePercent === null ? null : formatPercentagePoints(data.changePercent, locale, { maximumFractionDigits: 2 })
  const volumeText = data.volume === null ? unavailable : new Intl.NumberFormat(locale).format(data.volume)
  const marketStateText = t(`assetDetail.marketStates.${data.marketState ?? 'unknown'}`)
  const asOfText = t('assetDetail.asOf', { date: formatAsOfTimestamp(data.source.asOf, locale, unavailable) })

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={marketsStyles.content}>
        <View style={marketsStyles.page}>
          <BackControl destination={t('navigation.explorer')} fallback="/markets" label={t('assetDetail.back')} onPress={onBack} />

          {state.status === 'refresh-error' ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>
              {t('assetDetail.error.message')}
            </Text>
          ) : null}

          {/* Web's company card at phone width: the ticker's mark and symbol lead, the name
              beneath, and the watch toggle is an outline star beside the title. Then the price
              as the headline figure: the day's change under it, and a status line with the
              market state and how fresh the quote is. */}
          <ObjectHeader
            action={watchlistToggle.status === 'known' ? (
              <Button
                icon={watchlistToggle.isWatchlisted ? 'star-filled' : 'star'}
                label={isTogglingWatchlist
                  ? t('watchlist.toggle.pending')
                  : t(watchlistToggle.isWatchlisted ? 'watchlist.toggle.remove' : 'watchlist.toggle.add')}
                loading={isTogglingWatchlist}
                onPress={onToggleWatchlist}
                size="icon"
                variant="outline"
              />
            ) : undefined}
            descriptor={data.name ?? undefined}
            figure={(
              <View style={styles.figure}>
                <HeadlineFigure
                  accessibilityLabel={`${t('assetDetail.price')}, ${priceText}, ${t('assetDetail.change')}, ${changeText}`}
                  currency={data.currency}
                  deltas={data.change === null ? undefined : [{ value: data.change, label: changePercentText ?? '' }]}
                  label={t('assetDetail.price')}
                  labelTone="muted"
                  locale={locale}
                  size="md"
                  status={{ label: asOfText, tone: data.marketState === 'open' ? 'success' : 'muted' }}
                  value={data.price}
                />
              </View>
            )}
            leading={<EntityMark {...assetMark(data.symbol, null)} />}
            title={data.symbol}
          />

          <View>
            <ReadOnlyField label={t('assetDetail.marketState')} value={marketStateText} palette={palette} />
            <ReadOnlyField label={t('assetDetail.volume')} value={volumeText} palette={palette} separated />
          </View>

          <AssetPriceChart {...priceChart} palette={palette} />

          <TickerFundamentalsPanel state={fundamentals} currency={data.currency} palette={palette} />

          <TickerFinancialsPanel state={financials} palette={palette} />

          <TickerEarningsPanel state={earnings} palette={palette} />

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  figure: { marginTop: themeTokens.spacing[4] },
  banner: { ...textStyles.meta, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})

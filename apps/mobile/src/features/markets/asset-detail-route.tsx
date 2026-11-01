import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { ApiError } from '@/lib/api/errors'

import type { AssetPriceChartState } from './asset-price-chart'
import type { AssetDetailViewState, WatchlistToggleState } from './asset-detail-screen'
import { AssetDetailScreen } from './asset-detail-screen'
import { parseSymbol, type HistoricalPricePeriod } from './markets-contract'
import { mapEarningsChart, mapFinancialsChart, mapFundamentals, mapHistoricalPrice, mapQuote, mergeCompanyInfo } from './markets-view-model'
import type { TickerEarningsState } from './ticker-earnings-panel'
import type { TickerFinancialsState } from './ticker-financials-panel'
import type { TickerFundamentalsState } from './ticker-fundamentals-panel'
import { useCompanyInfo } from './use-company-info'
import { useHistoricalPrice } from './use-historical-price'
import { useQuote } from './use-quote'
import { useTickerEarnings } from './use-ticker-earnings'
import { useTickerFinancials } from './use-ticker-financials'
import { useTickerFundamentals } from './use-ticker-fundamentals'
import { useWatchlist } from './use-watchlist'
import { useAddToWatchlist, useRemoveFromWatchlist } from './use-watchlist-mutations'

/**
 * Mirrors AccountDetailRoute's exact dynamic-route param convention.
 *
 * The watchlist membership `GET` and the add/remove
 * mutations are wired here alongside the pre-existing quote query. They are
 * intentionally kept out of `AssetDetailViewState`: a still-loading or
 * errored watchlist query must not block the quote screen from rendering,
 * so `watchlistToggle` stays 'unknown' until membership is confirmed.
 */
export function AssetDetailRoute() {
  const params = useLocalSearchParams<{ symbol?: string | string[] }>()
  const symbol = parseSymbol(params.symbol)
  const query = useQuote(symbol)
  const companyInfo = useCompanyInfo(symbol)
  const [pricePeriod, setPricePeriod] = useState<HistoricalPricePeriod>('1Y')
  const priceHistory = useHistoricalPrice(symbol, pricePeriod)
  const fundamentals = useTickerFundamentals(symbol)
  const financials = useTickerFinancials(symbol)
  const earnings = useTickerEarnings(symbol)
  const watchlist = useWatchlist()
  const addMutation = useAddToWatchlist()
  const removeMutation = useRemoveFromWatchlist()
  const router = useRouter()
  let state: AssetDetailViewState

  if (query.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) {
    const data = mergeCompanyInfo(mapQuote(query.data), companyInfo.data?.companyInformation ?? null)
    state = query.isRefreshFailure ? { status: 'refresh-error', data } : { status: 'loaded', data }
  } else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const priceChartState: AssetPriceChartState = priceHistory.isAccessTransition || (!priceHistory.data && priceHistory.isPending)
    ? { status: 'loading' }
    : priceHistory.data
      ? { status: 'loaded', points: mapHistoricalPrice(priceHistory.data.prices) }
      : { status: 'error' }

  const fundamentalsState: TickerFundamentalsState = fundamentals.isAccessTransition || (!fundamentals.data && fundamentals.isPending)
    ? { status: 'loading' }
    : fundamentals.data
      ? { status: 'loaded', data: mapFundamentals(fundamentals.data) }
      : { status: 'error' }

  const financialsState: TickerFinancialsState = financials.isAccessTransition || (!financials.data && financials.isPending)
    ? { status: 'loading' }
    : financials.data
      ? { status: 'loaded', points: mapFinancialsChart(financials.data.financials) }
      : { status: 'error' }

  const earningsState: TickerEarningsState = earnings.isAccessTransition || (!earnings.data && earnings.isPending)
    ? { status: 'loading' }
    : earnings.data
      ? { status: 'loaded', points: mapEarningsChart(earnings.data.earnings) }
      : { status: 'error' }

  const isWatchlisted = symbol !== null && watchlist.data !== undefined
    && watchlist.data.symbols.includes(symbol.toUpperCase())
  const watchlistToggle: WatchlistToggleState = symbol !== null && watchlist.data !== undefined
    ? { status: 'known', isWatchlisted }
    : { status: 'unknown' }

  return (
    <AssetDetailScreen
      state={state}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/markets' as Href)
      }}
      onRetry={() => { void query.refetch() }}
      watchlistToggle={watchlistToggle}
      isTogglingWatchlist={addMutation.isPending || removeMutation.isPending}
      onToggleWatchlist={() => {
        if (symbol === null) return
        if (isWatchlisted) removeMutation.mutate(symbol)
        else addMutation.mutate(symbol)
      }}
      priceChart={{ state: priceChartState, period: pricePeriod, onSelectPeriod: setPricePeriod }}
      fundamentals={fundamentalsState}
      financials={financialsState}
      earnings={earningsState}
    />
  )
}

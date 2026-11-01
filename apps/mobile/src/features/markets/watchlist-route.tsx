import { useQueries } from '@tanstack/react-query'
import { type Href, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { createQuoteEndpoint } from './markets-contract'
import { buildWatchlistRows, type WatchlistQuoteResult } from './markets-view-model'
import { quoteKey } from './query-keys'
import { useWatchlist } from './use-watchlist'
import { useRemoveFromWatchlist } from './use-watchlist-mutations'
import type { WatchlistScreenState } from './watchlist-screen'
import { WatchlistScreen } from './watchlist-screen'

function resolveWatchlistState(
  watchlist: ReturnType<typeof useWatchlist>,
  quoteResults: readonly WatchlistQuoteResult[],
): WatchlistScreenState {
  if (watchlist.isAccessTransition) return { status: 'access-transition' }
  if (watchlist.data) {
    const rows = buildWatchlistRows(watchlist.data.symbols, quoteResults)
    return rows.length === 0 ? { status: 'empty' } : { status: 'loaded', rows }
  }
  if (watchlist.isLoading) return { status: 'loading' }
  if (watchlist.isInitialFailure) {
    const code = (watchlist.error as { code?: string } | null)?.code
    return code === 'invalid-response' ? { status: 'invalid-response' } : { status: 'error' }
  }
  return { status: 'loading' }
}

/**
 * The watchlist symbols and their quotes are two
 * independent request shapes: one list `GET`, then N parallel quote `GET`s
 * fetched with `useQueries` (this repo's first use of it), reusing
 * use-quote's exact query-key shape and read policy so the cache is shared
 * with the asset-detail screen. Each quote result is folded into its row
 * independently in `buildWatchlistRows`, so one failing quote degrades only
 * its own row rather than the whole list.
 */
export function WatchlistRoute() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('WatchlistRoute requires an authenticated runtime')
  const watchlist = useWatchlist()
  const removeMutation = useRemoveFromWatchlist()
  const router = useRouter()

  const symbols = watchlist.data?.symbols ?? []
  const quoteResults = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: quoteKey(runtime.epochId, symbol),
      queryFn: () => runtime.apiClient.read(createQuoteEndpoint(symbol)),
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })),
  }) as readonly WatchlistQuoteResult[]

  const removingSymbol = removeMutation.isPending ? (removeMutation.variables ?? null) : null

  return (
    <WatchlistScreen
      state={resolveWatchlistState(watchlist, quoteResults)}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/markets' as Href)
      }}
      onRetry={() => { void watchlist.refetch() }}
      onSelectSymbol={(symbol) => router.push({ pathname: '/markets/[symbol]', params: { symbol } })}
      onRemove={(symbol) => removeMutation.mutate(symbol)}
      removingSymbol={removingSymbol}
    />
  )
}

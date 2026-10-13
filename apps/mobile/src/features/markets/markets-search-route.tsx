import { type Href, useRouter } from 'expo-router'
import { useState } from 'react'

import type { MarketsSearchScreenState } from './markets-search-screen'
import { MarketsSearchScreen } from './markets-search-screen'
import { mapSearchResults } from './markets-view-model'
import { useTickerSearch } from './use-ticker-search'

function resolveViewState(query: string, search: ReturnType<typeof useTickerSearch>): MarketsSearchScreenState {
  if (search.isAccessTransition) return { status: 'access-transition' }
  if (search.data) {
    const rows = mapSearchResults(search.data.results)
    return rows.length === 0 ? { status: 'empty' } : { status: 'loaded', rows }
  }
  if (search.isInitialFailure) {
    const code = (search.error as { code?: string } | null)?.code
    return code === 'invalid-response' ? { status: 'invalid-response' } : { status: 'error' }
  }
  return query.trim().length === 0 ? { status: 'idle' } : { status: 'loading' }
}

/**
 * RAD-238 (slice 1) — the raw query text is owned here (not inside
 * useTickerSearch) so the search input can stay fully controlled while the
 * hook debounces internally. Mirrors ConnectBankRoute's back-navigation
 * fallback: prefer router.back(), fall back to the More hub.
 */
export function MarketsSearchRoute() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const search = useTickerSearch(query)

  return (
    <MarketsSearchScreen
      state={resolveViewState(query, search)}
      query={query}
      onQueryChange={setQuery}
      onSelectSymbol={(symbol) => router.push({ pathname: '/markets/[symbol]', params: { symbol } })}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/more' as Href)
      }}
      onOpenWatchlist={() => router.push('/markets/watchlist' as Href)}
      onOpenScreener={() => router.push('/markets/screener' as Href)}
    />
  )
}

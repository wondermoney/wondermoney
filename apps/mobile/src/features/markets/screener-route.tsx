import { useEffect, useRef, useState } from 'react'
import { type Href, useRouter } from 'expo-router'

import type { ScreenerEntryDto, ScreenerFilters, ScreenerResponseDto } from './markets-contract'
import { mapScreenerResults } from './markets-view-model'
import { ScreenerScreen, type ScreenerFilterFormValues, type ScreenerScreenState } from './screener-screen'
import { useScreener } from './use-screener'

const SCREENER_PAGE_SIZE = 25

const emptyForm: ScreenerFilterFormValues = {
  isEtf: false,
  isActivelyTrading: true,
  priceMoreThan: '',
  priceLowerThan: '',
  marketCapMoreThan: '',
  marketCapLowerThan: '',
  sector: null,
  industry: null,
  country: null,
  exchange: null,
}

type AppliedFilters = Omit<ScreenerFilters, 'page' | 'limit'>

function parseNumberInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildAppliedFilters(form: ScreenerFilterFormValues): AppliedFilters {
  return {
    isEtf: form.isEtf,
    isActivelyTrading: form.isActivelyTrading,
    priceMoreThan: parseNumberInput(form.priceMoreThan),
    priceLowerThan: parseNumberInput(form.priceLowerThan),
    marketCapMoreThan: parseNumberInput(form.marketCapMoreThan),
    marketCapLowerThan: parseNumberInput(form.marketCapLowerThan),
    sector: form.sector ?? undefined,
    industry: form.industry ?? undefined,
    country: form.country ?? undefined,
    exchange: form.exchange ?? undefined,
  }
}

function resolveScreenerState(
  applied: AppliedFilters | null,
  accumulated: readonly ScreenerEntryDto[],
  hasMore: boolean,
  screener: ReturnType<typeof useScreener>,
): ScreenerScreenState {
  if (screener.isAccessTransition) return { status: 'access-transition' }
  if (applied === null) return { status: 'idle' }

  if (accumulated.length === 0) {
    if (screener.data) return { status: 'empty' }
    if (screener.isInitialFailure) {
      const code = (screener.error as { code?: string } | null)?.code
      return code === 'invalid-response' ? { status: 'invalid-response' } : { status: 'error' }
    }
    return { status: 'loading' }
  }

  return {
    status: 'loaded',
    rows: mapScreenerResults(accumulated),
    hasMore,
    loadingMore: screener.isFetching && !screener.data,
    loadMoreError: screener.isInitialFailure,
  }
}

/**
 * Filters are staged in `form` (fully controlled, fires
 * no request) and only become live in `applied` once "Apply filters" is
 * pressed: an explicit submit rather than markets-search's debounce, since
 * the screener has several fields adjusted together and a heavier query
 * than a single search term.
 *
 * Pagination is NOT `useInfiniteQuery`: `useScreener` fetches one page at a
 * time (like `useQuote` fetches one symbol), keyed by filters+page, and
 * this route accumulates pages itself in `accumulated`/`hasMore`, merged
 * from a single effect keyed on the query's data reference so each page is
 * merged exactly once. "Apply filters" resets `page`, `accumulated`, and
 * `hasMore` synchronously (not through the effect) so the reset is visible
 * on the very next render, before the new page's request even resolves —
 * this is what keeps a filter change from flashing the previous filter
 * set's stale rows while the new query is in flight. "Load more" either
 * advances to the next page, or — if the last page attempt failed —
 * retries that same page instead of skipping ahead.
 */
export function ScreenerRoute() {
  const router = useRouter()
  const [form, setForm] = useState<ScreenerFilterFormValues>(emptyForm)
  const [applied, setApplied] = useState<AppliedFilters | null>(null)
  const [page, setPage] = useState(0)
  const [accumulated, setAccumulated] = useState<readonly ScreenerEntryDto[]>([])
  const [hasMore, setHasMore] = useState(false)
  // Bumped on every "Apply filters" press so the merge effect below always
  // re-runs after a reset, even in the (rare) case the new page's data
  // object is reference-equal to what was already merged — e.g. resubmitting
  // identical filters, where react-query serves the same cached page.
  const [generation, setGeneration] = useState(0)
  const mergedDataRef = useRef<ScreenerResponseDto | undefined>(undefined)

  const filters: ScreenerFilters | null = applied === null ? null : { ...applied, page, limit: SCREENER_PAGE_SIZE }
  const screener = useScreener(filters)

  useEffect(() => {
    if (!screener.data || screener.data === mergedDataRef.current) return
    mergedDataRef.current = screener.data
    const currentData = screener.data
    setAccumulated((prev) => (page === 0 ? currentData.results : [...prev, ...currentData.results]))
    setHasMore(currentData.hasMore)
  }, [generation, page, screener.data])

  const onApplyFilters = () => {
    mergedDataRef.current = undefined
    setPage(0)
    setAccumulated([])
    setHasMore(false)
    setGeneration((current) => current + 1)
    setApplied(buildAppliedFilters(form))
  }

  const onLoadMore = () => {
    if (applied === null || !hasMore) return
    if (screener.isInitialFailure) { void screener.refetch(); return }
    setPage((current) => current + 1)
  }

  return (
    <ScreenerScreen
      state={resolveScreenerState(applied, accumulated, hasMore, screener)}
      form={form}
      onFormChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
      onApplyFilters={onApplyFilters}
      onLoadMore={onLoadMore}
      onSelectSymbol={(symbol) => router.push({ pathname: '/markets/[symbol]', params: { symbol } })}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/markets' as Href)
      }}
    />
  )
}

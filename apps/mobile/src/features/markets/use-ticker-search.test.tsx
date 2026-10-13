import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { SEARCH_DEBOUNCE_MS, useTickerSearch } from './use-ticker-search'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpochId = 7
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: mockEpochId, apiClient: { read: mockRead, write: mockWrite } },
    blockAccess: mockBlockAccess,
  }),
}))

const value = { results: [{ currency: null, exchange: null, name: 'Apple Inc', symbol: 'AAPL', type: null }], source: { asOf: null, provider: 'eodhd' } }

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useTickerSearch', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('makes zero requests for an empty or blank search term', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerSearch(''), { wrapper })
    await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS) })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount()

    const blank = await renderHook(() => useTickerSearch('   '), { wrapper })
    await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS) })
    expect(mockRead).not.toHaveBeenCalled()
    await blank.unmount()
    client.clear()
  })

  it('debounces the raw term before firing the exact search endpoint', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    let term = ''
    const hook = await renderHook(() => useTickerSearch(term), { wrapper })
    term = 'a'
    await hook.rerender({})
    term = 'aa'
    await hook.rerender({})
    term = 'aap'
    await hook.rerender({})
    term = 'aapl'
    await hook.rerender({})
    expect(mockRead).not.toHaveBeenCalled()

    await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS) })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/v1/financial-markets/ticker/search?searchTerm=aapl' }),
    )
    expect(client.getQueryData(['markets', 7, 'search', 'aapl'])).toEqual(value)
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('trims the debounced term for the request, key, and gate', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerSearch('  aapl  '), { wrapper })
    await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS) })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/v1/financial-markets/ticker/search?searchTerm=aapl' }),
    )
    expect(client.getQueryData(['markets', 7, 'search', 'aapl'])).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it('uses the exact read policy (no retry, no focus/reconnect refetch)', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useTickerSearch('aapl'), { wrapper })
    await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS) })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(client.getQueryCache().find({ queryKey: ['markets', 7, 'search', 'aapl'] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    await hook.unmount()
    client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses data for %s and transitions access when required',
    async (code) => {
      mockRead.mockRejectedValue(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useTickerSearch('aapl'), { wrapper })
      await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS) })
      await waitFor(() => expect(hook.result.current.isInitialFailure).toBe(true))
      expect(hook.result.current.data).toBeUndefined()
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )
})

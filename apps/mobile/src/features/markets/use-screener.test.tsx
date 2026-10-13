import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useScreener } from './use-screener'

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

const value = {
  hasMore: true,
  page: 0,
  pageSize: 25,
  results: [{
    beta: null,
    country: null,
    dividendYield: null,
    industry: null,
    marketCap: 3_000_000_000_000,
    name: 'Apple Inc',
    peRatio: null,
    price: 232.5,
    sector: 'Technology',
    symbol: 'AAPL',
    volume: null,
  }],
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
}

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useScreener', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads through the exact endpoint and a key scoped by every filter and page, without writes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useScreener({ isEtf: false, isActivelyTrading: true, page: 0, limit: 25 }), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&page=0&limit=25' }),
    )
    expect(client.getQueryData(['markets', 7, 'screener', false, true, null, null, null, null, null, null, null, null, 0, 25])).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: ['markets', 7, 'screener', false, true, null, null, null, null, null, null, null, null, 0, 25] })?.options)
      .toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('fires a fresh request when the page changes, keeping the previous page cached separately', async () => {
    mockRead.mockResolvedValueOnce(value).mockResolvedValueOnce({ ...value, page: 1, hasMore: false })
    const { client, wrapper } = setup()
    const hook = await renderHook(({ page }: { page: number }) => useScreener({ isEtf: false, isActivelyTrading: true, page, limit: 25 }), { wrapper, initialProps: { page: 0 } })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { hook.rerender({ page: 1 }) })
    await waitFor(() => expect(hook.result.current.data).toEqual({ ...value, page: 1, hasMore: false }))
    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(['markets', 7, 'screener', false, true, null, null, null, null, null, null, null, null, 0, 25])).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it('makes zero requests while filters are null (not yet submitted)', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useScreener(null), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('retains cached data on an ordinary refresh failure', async () => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useScreener({ isEtf: false, isActivelyTrading: true, page: 0, limit: 25 }), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses cached data for %s and transitions access when required',
    async (code) => {
      mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useScreener({ isEtf: false, isActivelyTrading: true, page: 0, limit: 25 }), { wrapper })
      await waitFor(() => expect(hook.result.current.data).toEqual(value))
      await act(async () => { await hook.result.current.refetch() })
      await waitFor(() => expect(hook.result.current.data).toBeUndefined())
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )
})

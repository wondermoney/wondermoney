import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useQuote } from './use-quote'

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
  change: 1.23,
  changePercent: 0.45,
  currency: 'USD',
  marketState: 'open',
  name: 'Apple Inc',
  price: 232.5,
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
  symbol: 'AAPL',
  timestamp: '2026-08-10T10:00:00.000Z',
  volume: 1_000_000,
}

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useQuote', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads through the exact endpoint and isolated key without writes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useQuote('AAPL'), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/v1/financial-markets/ticker/AAPL/quote' }),
    )
    expect(client.getQueryData(['markets', 7, 'quote', 'AAPL'])).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: ['markets', 7, 'quote', 'AAPL'] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('makes zero requests for a null or overlong symbol', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useQuote(null), { wrapper })
    expect(hook.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount()

    const overlong = await renderHook(() => useQuote('A'.repeat(21)), { wrapper })
    expect(overlong.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await overlong.unmount()
    client.clear()
  })

  it('classifies a 404 as not found and retains cached data on an ordinary refresh failure', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('http', 404))
    const missing = setup()
    const missingHook = await renderHook(() => useQuote('ZZZZ'), { wrapper: missing.wrapper })
    await waitFor(() => expect(missingHook.result.current.isNotFound).toBe(true))
    await missingHook.unmount()
    missing.client.clear()

    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const cached = setup()
    const cachedHook = await renderHook(() => useQuote('AAPL'), { wrapper: cached.wrapper })
    await waitFor(() => expect(cachedHook.result.current.data).toEqual(value))
    await act(async () => { await cachedHook.result.current.refetch() })
    await waitFor(() => expect(cachedHook.result.current.isRefreshFailure).toBe(true))
    expect(cachedHook.result.current.data).toEqual(value)
    await cachedHook.unmount()
    cached.client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses cached data for %s and transitions access when required',
    async (code) => {
      mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useQuote('AAPL'), { wrapper })
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

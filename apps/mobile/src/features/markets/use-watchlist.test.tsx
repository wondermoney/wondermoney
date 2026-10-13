import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useWatchlist } from './use-watchlist'

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

const value = { symbols: ['AAPL', 'MSFT'] }

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useWatchlist', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads through the exact endpoint and isolated key without writes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useWatchlist(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/v1/financial-markets/watchlist' }),
    )
    expect(client.getQueryData(['markets', 7, 'watchlist'])).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: ['markets', 7, 'watchlist'] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('retains cached data on an ordinary refresh failure', async () => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useWatchlist(), { wrapper })
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
      const hook = await renderHook(() => useWatchlist(), { wrapper })
      await waitFor(() => expect(hook.result.current.data).toEqual(value))
      await act(async () => { await hook.result.current.refetch() })
      await waitFor(() => expect(hook.result.current.data).toBeUndefined())
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )

  it('classifies an initial failure with no cached data', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useWatchlist(), { wrapper })
    await waitFor(() => expect(hook.result.current.isInitialFailure).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount()
    client.clear()
  })
})

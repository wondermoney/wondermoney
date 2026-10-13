import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useAddToWatchlist, useRemoveFromWatchlist } from './use-watchlist-mutations'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const mockEpochId = 12
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: mockEpochId, apiClient: { read: mockRead, write: mockWrite } },
    blockAccess: mockBlockAccess,
  }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useAddToWatchlist', () => {
  beforeEach(() => {
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('PUTs the exact uppercased-symbol endpoint and invalidates the watchlist query on commit', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(['markets', 12, 'watchlist'], { symbols: [] })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useAddToWatchlist(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('aapl') })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PUT', path: '/v1/financial-markets/watchlist/AAPL' }),
      expect.objectContaining({ commit: expect.any(Function) }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['markets', 12, 'watchlist'] })
    await hook.unmount()
    client.clear()
  })

  it('does not invalidate before commit fires', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let commit: (() => void) | undefined
    mockWrite.mockImplementation(async (_endpoint, options) => { commit = options.commit })
    const hook = await renderHook(() => useAddToWatchlist(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('AAPL') })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { commit?.() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['markets', 12, 'watchlist'] })
    await hook.unmount()
    client.clear()
  })

  it('does not build a client-side "already watchlisted" guard: adding is called even when the symbol is already present', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(['markets', 12, 'watchlist'], { symbols: ['AAPL'] })
    mockWrite.mockResolvedValue(undefined)
    const hook = await renderHook(() => useAddToWatchlist(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('AAPL') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })

  it('blocks access on mfa-required failures', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required'))
    const hook = await renderHook(() => useAddToWatchlist(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('AAPL')).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount()
    client.clear()
  })
})

describe('useRemoveFromWatchlist', () => {
  beforeEach(() => {
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('DELETEs the exact uppercased-symbol endpoint and invalidates the watchlist query on commit', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(['markets', 12, 'watchlist'], { symbols: ['AAPL'] })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useRemoveFromWatchlist(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('aapl') })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE', path: '/v1/financial-markets/watchlist/AAPL' }),
      expect.objectContaining({ commit: expect.any(Function) }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['markets', 12, 'watchlist'] })
    await hook.unmount()
    client.clear()
  })

  it('does not build a client-side "already absent" guard: removing is called even when the symbol is not present', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(['markets', 12, 'watchlist'], { symbols: [] })
    mockWrite.mockResolvedValue(undefined)
    const hook = await renderHook(() => useRemoveFromWatchlist(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('ZZZZ') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })

  it('blocks access on mfa-required failures', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required'))
    const hook = await renderHook(() => useRemoveFromWatchlist(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('AAPL')).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount()
    client.clear()
  })

  it('rejects a second concurrent call while one is already in flight', async () => {
    const { client, wrapper } = setup()
    let rejectWrite: ((reason: unknown) => void) | undefined
    mockWrite.mockImplementation(() => new Promise((_resolve, reject) => { rejectWrite = reject }))
    const hook = await renderHook(() => useRemoveFromWatchlist(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync('AAPL') })
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
    await act(async () => { await expect(hook.result.current.mutateAsync('MSFT')).rejects.toThrow('already pending') })
    await act(async () => { rejectWrite?.(new Error('boom')); await expect(first).rejects.toThrow('boom') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })
})

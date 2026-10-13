import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useAccount } from './use-account'

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

const value = { account: { accountKey: 42 } }
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useAccount', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads authoritative detail with exact endpoint and isolated key without writes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccount(42), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/account/42' }))
    expect(client.getQueryData(['account', 7, 42])).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: ['account', 7, 42] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('makes zero requests for an invalid route id', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccount(null), { wrapper })
    expect(hook.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('classifies 404 as not found and ordinary refresh failure retains valid cached detail', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('http', 404))
    const first = setup()
    const missing = await renderHook(() => useAccount(42), { wrapper: first.wrapper })
    await waitFor(() => expect(missing.result.current.isNotFound).toBe(true))
    await missing.unmount()
    first.client.clear()

    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const second = setup()
    const cached = await renderHook(() => useAccount(42), { wrapper: second.wrapper })
    await waitFor(() => expect(cached.result.current.data).toEqual(value))
    await act(async () => { await cached.result.current.refetch() })
    await waitFor(() => expect(cached.result.current.isRefreshFailure).toBe(true))
    expect(cached.result.current.data).toEqual(value)
    await cached.unmount()
    second.client.clear()

    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('http', 404))
    const third = setup()
    const removed = await renderHook(() => useAccount(42), { wrapper: third.wrapper })
    await waitFor(() => expect(removed.result.current.data).toEqual(value))
    await act(async () => { await removed.result.current.refetch() })
    await waitFor(() => expect(removed.result.current.isNotFound).toBe(true))
    expect(removed.result.current.data).toBeUndefined()
    expect(removed.result.current.isRefreshFailure).toBe(false)
    await removed.unmount()
    third.client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses cached detail for %s and transitions access when required',
    async (code) => {
      mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useAccount(42), { wrapper })
      await waitFor(() => expect(hook.result.current.data).toEqual(value))
      await act(async () => { await hook.result.current.refetch() })
      await waitFor(() => expect(hook.result.current.data).toBeUndefined())
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )

  it('separates detail data across account and epoch keys', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    let accountId = 42
    const hook = await renderHook(() => useAccount(accountId), { wrapper })
    await waitFor(() => expect(client.getQueryData(['account', 7, 42])).toEqual(value))
    accountId = 43
    await hook.rerender({})
    await waitFor(() => expect(client.getQueryData(['account', 7, 43])).toEqual(value))
    mockEpochId = 8
    await hook.rerender({})
    await waitFor(() => expect(client.getQueryData(['account', 8, 43])).toEqual(value))
    await hook.unmount()
    client.clear()
  })
})

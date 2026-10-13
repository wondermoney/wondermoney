import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useAccounts } from './use-accounts'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockRuntime: { epochId: number; apiClient: { read: typeof mockRead; write: typeof mockWrite } } | null
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: mockRuntime, blockAccess: mockBlockAccess }),
}))

const value = { accounts: [] }
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useAccounts', () => {
  beforeEach(() => {
    mockRuntime = { epochId: 7, apiClient: { read: mockRead, write: mockWrite } }
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads through the exact read endpoint, epoch key, and never writes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccounts(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/account' }))
    expect(client.getQueryData(['accounts', 7])).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: ['accounts', 7] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('reports refresh state and retains stale data for an ordinary refresh failure', async () => {
    let rejectRefresh!: (error: Error) => void
    mockRead.mockResolvedValueOnce(value).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject }))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccounts(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(() => { void hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.isRefreshing).toBe(true))
    await act(() => rejectRefresh(new ApiError('network')))
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data).toEqual(value)
    expect(hook.result.current.isInitialFailure).toBe(false)
    await hook.unmount()
    client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)('synchronously suppresses stale data for %s', async (code) => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccounts(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeUndefined())
    expect(hook.result.current.isInitialFailure).toBe(true)
    expect(hook.result.current.isRefreshFailure).toBe(false)
    expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
    if (code === 'mfa-required') expect(mockBlockAccess).toHaveBeenCalledTimes(1)
    if (code === 'invalid-response') expect(mockBlockAccess).not.toHaveBeenCalled()
    await hook.rerender({})
    expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
    await hook.unmount()
    client.clear()
  })

  it('isolates data when the epoch changes', async () => {
    mockRead.mockResolvedValueOnce({ accounts: [{ marker: 'old' }] }).mockResolvedValueOnce(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccounts(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ accounts: [{ marker: 'old' }] }))
    mockRuntime = { ...mockRuntime!, epochId: 8 }
    await hook.rerender({})
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(client.getQueryData(['accounts', 7])).toEqual({ accounts: [{ marker: 'old' }] })
    expect(client.getQueryData(['accounts', 8])).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it('reports a request failure without prior data as initial', async () => {
    mockRead.mockRejectedValue(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccounts(), { wrapper })
    await waitFor(() => expect(hook.result.current.isInitialFailure).toBe(true))
    expect(hook.result.current.isRefreshFailure).toBe(false)
    expect(mockRead).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })
})

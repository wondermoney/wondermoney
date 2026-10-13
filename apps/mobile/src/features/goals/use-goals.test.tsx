import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useGoals } from './use-goals'

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

const value = { goals: [] }
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useGoals', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('uses the exact read endpoint and epoch key with conservative query policy', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/goals' }))
    expect(client.getQueryData(['goals', 7])).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: ['goals', 7] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('reads the includeArchived variant into an isolated cache key when requested', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoals(true), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/goals?includeArchived=true' }))
    expect(client.getQueryData(['goals', 'archived', 7])).toEqual(value)
    expect(client.getQueryData(['goals', 7])).toBeUndefined()
    await hook.unmount()
    client.clear()
  })

  it('retains verified same-epoch data after an ordinary refresh failure', async () => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses stale data for %s and blocks access where required',
    async (code) => {
      mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useGoals(), { wrapper })
      await waitFor(() => expect(hook.result.current.data).toEqual(value))
      await act(async () => { await hook.result.current.refetch() })
      await waitFor(() => expect(hook.result.current.data).toBeUndefined())
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )

  it('suppresses stale data after a 404 without triggering an access transition', async () => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('http', 404))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeUndefined())
    expect(hook.result.current.isNotFound).toBe(true)
    expect(hook.result.current.isAccessTransition).toBe(false)
    expect(mockBlockAccess).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('isolates data when the authenticated epoch changes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(client.getQueryData(['goals', 7])).toEqual(value))
    mockEpochId = 8
    await hook.rerender({})
    await waitFor(() => expect(client.getQueryData(['goals', 8])).toEqual(value))
    await hook.unmount()
    client.clear()
  })
})

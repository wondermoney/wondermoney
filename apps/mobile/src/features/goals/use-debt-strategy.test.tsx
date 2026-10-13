import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { debtStrategyFixture } from './test-fixtures'
import { useDebtStrategy } from './use-debt-strategy'

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

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useDebtStrategy', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('uses the exact read endpoint and epoch key with conservative query policy', async () => {
    mockRead.mockResolvedValue(debtStrategyFixture)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useDebtStrategy(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(debtStrategyFixture))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/goals/debt-strategy' }))
    expect(client.getQueryData(['goals', 'debt-strategy', 7])).toEqual(debtStrategyFixture)
    expect(client.getQueryCache().find({ queryKey: ['goals', 'debt-strategy', 7] })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('retains verified same-epoch data after an ordinary refresh failure', async () => {
    mockRead.mockResolvedValueOnce(debtStrategyFixture).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useDebtStrategy(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(debtStrategyFixture))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data).toEqual(debtStrategyFixture)
    await hook.unmount()
    client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses stale data for %s and blocks access where required',
    async (code) => {
      mockRead.mockResolvedValueOnce(debtStrategyFixture).mockRejectedValueOnce(new ApiError(code))
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useDebtStrategy(), { wrapper })
      await waitFor(() => expect(hook.result.current.data).toEqual(debtStrategyFixture))
      await act(async () => { await hook.result.current.refetch() })
      await waitFor(() => expect(hook.result.current.data).toBeUndefined())
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(hook.result.current.isInvalidResponse).toBe(code === 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )

  it('isolates data when the authenticated epoch changes', async () => {
    mockRead.mockResolvedValue(debtStrategyFixture)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useDebtStrategy(), { wrapper })
    await waitFor(() => expect(client.getQueryData(['goals', 'debt-strategy', 7])).toEqual(debtStrategyFixture))
    mockEpochId = 8
    await hook.rerender({})
    await waitFor(() => expect(client.getQueryData(['goals', 'debt-strategy', 8])).toEqual(debtStrategyFixture))
    await hook.unmount()
    client.clear()
  })
})

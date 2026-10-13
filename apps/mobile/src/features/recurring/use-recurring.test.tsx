import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useRecurringItems } from './use-recurring-items'
import { useRecurringSummary } from './use-recurring-summary'
import { recurringSummaryFixture } from './test-fixtures'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpoch = 8
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }) }))
const setup = () => { const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> } }

describe('recurring hooks', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset(); mockEpoch = 8 })
  it('uses separate conservative reads in the current epoch', async () => {
    mockRead.mockImplementation(async (endpoint) => endpoint.path.endsWith('/summary') ? recurringSummaryFixture : { items: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => ({ items: useRecurringItems(), summary: useRecurringSummary() }), { wrapper })
    await waitFor(() => expect(hook.result.current.summary.data).toEqual(recurringSummaryFixture))
    expect(client.getQueryData(['recurring', 8, 'items'])).toEqual({ items: [] })
    expect(client.getQueryData(['recurring', 8, 'summary'])).toEqual(recurringSummaryFixture)
    for (const query of client.getQueryCache().findAll({ queryKey: ['recurring', 8] })) expect(query.options).toMatchObject({ retry: false, refetchInterval: false, refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY })
    await hook.unmount(); client.clear()
  })
  it('does not auto-refetch on remount after global stale time, while explicit refresh still reads', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockRead.mockResolvedValue({ items: [] })
    const { client, wrapper } = setup()
    const first = await renderHook(() => useRecurringItems(), { wrapper })
    await waitFor(() => expect(first.result.current.data).toEqual({ items: [] }))
    expect(mockRead).toHaveBeenCalledTimes(1)
    await first.unmount()

    now.mockReturnValue(1_031_000)
    const remounted = await renderHook(() => useRecurringItems(), { wrapper })
    await waitFor(() => expect(remounted.result.current.data).toEqual({ items: [] }))
    expect(mockRead).toHaveBeenCalledTimes(1)

    await act(async () => { await remounted.result.current.refetch() })
    expect(mockRead).toHaveBeenCalledTimes(2)
    await remounted.unmount()
    client.clear()
    now.mockRestore()
  })
  it('retains stale data for an ordinary refresh failure', async () => {
    mockRead.mockResolvedValueOnce({ items: [] }).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useRecurringItems(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ items: [] }))
    await act(async () => { await hook.result.current.refetch() })
    expect(hook.result.current.data).toEqual({ items: [] })
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    await hook.unmount(); client.clear()
  })
  it('does not reuse list data across auth epochs', async () => {
    mockRead.mockResolvedValueOnce({ items: [{ marker: 'epoch-8' }] }).mockResolvedValueOnce({ items: [] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useRecurringItems(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ items: [{ marker: 'epoch-8' }] }))
    mockEpoch = 9
    await hook.rerender({})
    await waitFor(() => expect(hook.result.current.data).toEqual({ items: [] }))
    expect(client.getQueryData(['recurring', 8, 'items'])).toEqual({ items: [{ marker: 'epoch-8' }] })
    expect(client.getQueryData(['recurring', 9, 'items'])).toEqual({ items: [] })
    await hook.unmount(); client.clear()
  })
  it.each(['invalid-response', 'mfa-required'] as const)('suppresses data for %s', async (code) => {
    mockRead.mockRejectedValue(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useRecurringSummary(), { wrapper })
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
    expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
    await hook.unmount(); client.clear()
  })
})

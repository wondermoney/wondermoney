import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { goalFixture } from './test-fixtures'
import { useGoalDetail } from './use-goal-detail'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpochId = 7
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: mockEpochId, apiClient: { read: mockRead, write: jest.fn() } },
    blockAccess: mockBlockAccess,
  }),
}))

const { summary, ...goal } = goalFixture
const detail = { goal, summary }
const item = (goalActivityKey: number) => ({
  goalActivityKey,
  type: 'assigned' as const,
  amount: goalActivityKey,
  occurredAt: `2026-07-${String(20 - goalActivityKey).padStart(2, '0')}T10:00:00.000Z`,
  currencyCode: undefined,
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useGoalDetail', () => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads 25-item offset pages, deduplicates by activity id, and refreshes from zero', async () => {
    mockRead.mockImplementation(({ path }: { path: string }) => {
      if (path === '/v1/goals/3') return Promise.resolve(detail)
      if (path.endsWith('offset=0')) return Promise.resolve({ activities: Array.from({ length: 25 }, (_, index) => item(index + 1)), limit: 25, offset: 0, total: 26 })
      if (path.endsWith('offset=25')) return Promise.resolve({ activities: [item(25), item(26)], limit: 25, offset: 25, total: 26 })
      throw new Error(`unexpected ${path}`)
    })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoalDetail(3), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.activities).toHaveLength(25))
    expect(hook.result.current.hasMore).toBe(true)
    await act(async () => { await hook.result.current.loadMore() })
    await waitFor(() => expect(hook.result.current.data?.activities).toHaveLength(26))
    expect(hook.result.current.data?.activities.at(-1)?.goalActivityKey).toBe(26)
    expect(hook.result.current.hasMore).toBe(false)
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/goals/3/activity?limit=25&offset=25' }))

    const beforeRefresh = mockRead.mock.calls.length
    let recovered = false
    await act(async () => { recovered = await hook.result.current.refresh() })
    expect(recovered).toBe(true)
    const refreshPaths = mockRead.mock.calls.slice(beforeRefresh).map(([endpoint]) => endpoint.path)
    expect(refreshPaths[0]).toBe('/v1/goals/3')
    expect(refreshPaths[1]).toBe('/v1/goals/3/activity?limit=25&offset=0')
    await hook.unmount()
    client.clear()
  })

  it('retains verified same-epoch data after an ordinary detail refresh failure', async () => {
    let failDetail = false
    mockRead.mockImplementation(({ path }: { path: string }) => {
      if (path === '/v1/goals/3') return failDetail ? Promise.reject(new ApiError('network')) : Promise.resolve(detail)
      return Promise.resolve({ activities: [], limit: 25, offset: 0, total: 0 })
    })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoalDetail(3), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.detail).toEqual(detail))
    failDetail = true
    let recovered = true
    await act(async () => { recovered = await hook.result.current.refresh() })
    expect(recovered).toBe(false)
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data?.detail).toEqual(detail)
    await hook.unmount()
    client.clear()
  })

  it('does not report recovery when detail succeeds but activity refresh fails', async () => {
    let failActivity = false
    mockRead.mockImplementation(({ path }: { path: string }) => {
      if (path === '/v1/goals/3') return Promise.resolve(detail)
      return failActivity ? Promise.reject(new ApiError('network')) : Promise.resolve({ activities: [], limit: 25, offset: 0, total: 0 })
    })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoalDetail(3), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    failActivity = true
    let recovered = true
    await act(async () => { recovered = await hook.result.current.refresh() })
    expect(recovered).toBe(false)
    await hook.unmount(); client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)(
    'suppresses stale detail for %s and routes access failures through the boundary',
    async (code) => {
      let failDetail = false
      mockRead.mockImplementation(({ path }: { path: string }) => {
        if (path === '/v1/goals/3') return failDetail ? Promise.reject(new ApiError(code)) : Promise.resolve(detail)
        return Promise.resolve({ activities: [], limit: 25, offset: 0, total: 0 })
      })
      const { client, wrapper } = setup()
      const hook = await renderHook(() => useGoalDetail(3), { wrapper })
      await waitFor(() => expect(hook.result.current.data).toBeDefined())
      failDetail = true
      await act(async () => { await hook.result.current.refresh() })
      await waitFor(() => expect(hook.result.current.data).toBeUndefined())
      expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
      expect(mockBlockAccess).toHaveBeenCalledTimes(code === 'invalid-response' ? 0 : 1)
      await hook.unmount()
      client.clear()
    },
  )

  it('does not request either endpoint for an invalid id and isolates cache keys by epoch', async () => {
    mockRead.mockImplementation(({ path }: { path: string }) => path === '/v1/goals/3'
      ? Promise.resolve(detail)
      : Promise.resolve({ activities: [], limit: 25, offset: 0, total: 0 }))
    const invalidSetup = setup()
    const invalid = await renderHook(() => useGoalDetail(null), { wrapper: invalidSetup.wrapper })
    expect(invalid.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await invalid.unmount()
    invalidSetup.client.clear()

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useGoalDetail(3), { wrapper })
    await waitFor(() => expect(client.getQueryData(['goal', 7, 3])).toEqual(detail))
    mockEpochId = 8
    await hook.rerender({})
    await waitFor(() => expect(client.getQueryData(['goal', 8, 3])).toEqual(detail))
    await hook.unmount()
    client.clear()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyProposalDecisionFailure, usePendingProposalCount } from './use-assistant-proposals'

const mockRead = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 5, apiClient: { read: mockRead } } }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

function readsWith(aiHidden: boolean, proposals: () => Promise<unknown>) {
  mockRead.mockImplementation(async (endpoint: { path: string }) => (
    endpoint.path === '/v1/user/me/preferences' ? { aiHidden, previewFeatures: false } : proposals()
  ))
}

const pending = (id: number) => ({
  id,
  kind: 'mark_transactions_reviewed',
  source: 'mcp',
  status: 'pending',
  summary: 'Mark 1 transaction as reviewed',
  createdAt: '2026-11-10T10:00:00.000Z',
  expiresAt: '2026-11-17T10:00:00.000Z',
  decidedAt: null,
  failureReason: null,
  changes: [],
  unavailableCount: 1,
})

describe('usePendingProposalCount', () => {
  beforeEach(() => mockRead.mockReset())

  it('counts the pending proposals for the badge', async () => {
    readsWith(false, async () => ({ proposals: [pending(1), pending(2)] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } })
    const hook = await renderHook(() => usePendingProposalCount(), { wrapper: wrap(client) })

    await waitFor(() => expect(hook.result.current).toEqual({ available: true, count: 2 }))
    await hook.unmount()
    client.clear()
  })

  it('is unavailable, and reads no proposals, when the person hid AI', async () => {
    readsWith(true, async () => ({ proposals: [pending(1)] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } })
    const hook = await renderHook(() => usePendingProposalCount(), { wrapper: wrap(client) })

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1))
    expect(hook.result.current).toEqual({ available: false, count: 0 })
    expect(mockRead).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('/v1/assistant/proposals') }))
    await hook.unmount()
    client.clear()
  })

  it('is unavailable on a server that predates proposals', async () => {
    readsWith(false, async () => { throw new ApiError('http', 404) })
    const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } })
    const hook = await renderHook(() => usePendingProposalCount(), { wrapper: wrap(client) })

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(hook.result.current.available).toBe(false))
    await hook.unmount()
    client.clear()
  })
})

describe('classifyProposalDecisionFailure', () => {
  it('treats a 404 or 409 as a proposal that is gone', () => {
    expect(classifyProposalDecisionFailure(new ApiError('http', 409))).toBe('gone')
    expect(classifyProposalDecisionFailure(new ApiError('http', 404))).toBe('gone')
    expect(classifyProposalDecisionFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyProposalDecisionFailure(new ApiError('network'))).toBe('general')
  })
})

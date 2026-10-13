import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { PROCESSING_POLL_INTERVAL_MS } from '../connection-poll-policy'
import { useBankConnections } from '../use-bank-connections'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBankConnections polling', () => {
  beforeEach(() => {
    mockRead.mockReset(); mockBlockAccess.mockReset()
    jest.useFakeTimers()
  })
  afterEach(() => { jest.useRealTimers() })

  it('polls again after the fixed interval while a connection reads processing', async () => {
    mockRead.mockResolvedValue({ connections: [{ accessType: 'open_banking', dataFreshAsOf: null, expiresAt: null, institutionName: 'Bank', provider: 'GoCardless', status: 'processing' }] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankConnections(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(1)

    await act(async () => { await jest.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS) })
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await hook.unmount(); client.clear()
  })

  it('does not poll again once every connection reads a settled status', async () => {
    mockRead.mockResolvedValue({ connections: [{ accessType: 'open_banking', dataFreshAsOf: null, expiresAt: null, institutionName: 'Bank', provider: 'GoCardless', status: 'connected' }] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankConnections(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(PROCESSING_POLL_INTERVAL_MS * 2)
    expect(mockRead).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })
})

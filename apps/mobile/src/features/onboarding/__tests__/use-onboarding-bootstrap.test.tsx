import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useOnboardingBootstrap } from '../use-onboarding-bootstrap'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

const newUser = {
  onboarding: {
    completed: false,
    completedVersion: null,
    required: true,
    skippable: true,
    steps: [
      { done: false, key: 'net_worth_value' },
      { done: false, key: 'read_only_bank_access' },
      { done: false, key: 'privacy' },
    ],
    supportedActions: ['connect_bank', 'skip'],
    version: 1,
  },
}

describe('useOnboardingBootstrap', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('reads the self-scoped onboarding endpoint once with the documented path', async () => {
    const client = new QueryClient()
    mockRead.mockResolvedValue(newUser)
    const hook = await renderHook(() => useOnboardingBootstrap(), { wrapper: wrap(client) })
    await waitFor(() => expect(hook.result.current.data).toEqual(newUser))
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/user/me/onboarding' }))
    await hook.unmount(); client.clear()
  })

  it('routes mfa failures through blockAccess and suppresses the data', async () => {
    const client = new QueryClient()
    mockRead.mockRejectedValue(new ApiError('mfa-required', 403))
    const hook = await renderHook(() => useOnboardingBootstrap(), { wrapper: wrap(client) })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.isAccessTransition).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('marks the result as a not-found and suppresses data on a 404', async () => {
    const client = new QueryClient()
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const hook = await renderHook(() => useOnboardingBootstrap(), { wrapper: wrap(client) })
    await waitFor(() => expect(hook.result.current.isNotFound).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount(); client.clear()
  })

  it('does not auto-replay: retry, focus and reconnect flags are all off', async () => {
    const client = new QueryClient()
    mockRead.mockResolvedValue(newUser)
    const hook = await renderHook(() => useOnboardingBootstrap(), { wrapper: wrap(client) })
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    const [query] = client.getQueryCache().getAll()
    expect(query?.options).toMatchObject({ refetchOnReconnect: false, refetchOnWindowFocus: false, retry: false })
    hook.unmount(); client.clear()
  })
})

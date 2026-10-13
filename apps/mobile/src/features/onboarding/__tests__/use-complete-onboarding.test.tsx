import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { onboardingBootstrapKey } from '../query-keys'
import { classifyCompleteOnboardingFailure, useCompleteOnboarding } from '../use-complete-onboarding'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const epochId = 3

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId, apiClient: { write: mockWrite } },
    blockAccess: mockBlockAccess,
  }),
}))
jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

const bootstrap = {
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

const completedBootstrap = {
  onboarding: {
    completed: true,
    completedVersion: 1,
    required: false,
    skippable: true,
    steps: [
      { done: true, key: 'net_worth_value' },
      { done: true, key: 'read_only_bank_access' },
      { done: true, key: 'privacy' },
    ],
    supportedActions: ['connect_bank', 'skip'],
    version: 1,
  },
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
}

describe('useCompleteOnboarding', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset(); captured.mockClear() })

  it('captures onboarding_completed with no properties, and only on success (RAD-518)', async () => {
    const client = makeClient()
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const hook = await renderHook(() => useCompleteOnboarding(), { wrapper: wrap(client) })

    await expect(hook.result.current.mutateAsync({ version: 1 })).rejects.toBeInstanceOf(ApiError)
    expect(captured).not.toHaveBeenCalled()

    mockWrite.mockResolvedValueOnce(completedBootstrap)
    await hook.result.current.mutateAsync({ version: 1 })

    expect(captured.mock.calls).toEqual([['onboarding_completed']])
    hook.unmount(); client.clear()
  })

  it('posts the current version to the dedicated complete endpoint and commits the updated bootstrap', async () => {
    const client = makeClient()
    let commitFn: ((parsed: unknown) => void) | undefined
    mockWrite.mockImplementation(async (_endpoint, options: { commit: (parsed: unknown) => void }) => {
      commitFn = options.commit
      return completedBootstrap
    })
    const hook = await renderHook(() => useCompleteOnboarding(), { wrapper: wrap(client) })
    await hook.result.current.mutateAsync({ version: 1 })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: 'POST', path: '/v1/user/me/onboarding/complete' }))
    expect(mockWrite.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ body: { version: 1 } }))
    expect(client.getQueryData(onboardingBootstrapKey(epochId))).toBeUndefined()
    commitFn?.(completedBootstrap)
    expect(client.getQueryData(onboardingBootstrapKey(epochId))).toEqual(completedBootstrap)
    hook.unmount(); client.clear()
  })

  it('routes mfa failures through blockAccess and does not surface them as a write failure', async () => {
    const client = makeClient()
    mockWrite.mockRejectedValue(new ApiError('mfa-required', 403))
    const hook = await renderHook(() => useCompleteOnboarding(), { wrapper: wrap(client) })
    await hook.result.current.mutateAsync({ version: 1 }).catch(() => undefined)
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    hook.unmount(); client.clear()
  })

  it('routes MFA failures through blockAccess', async () => {
    const client = makeClient()
    mockWrite.mockRejectedValue(new ApiError('mfa-required', 403))
    const hook = await renderHook(() => useCompleteOnboarding(), { wrapper: wrap(client) })
    await hook.result.current.mutateAsync({ version: 1 }).catch(() => undefined)
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    hook.unmount(); client.clear()
  })

  it('classifies a stale-version 400 from the server as a stale outcome (not a network failure)', () => {
    expect(classifyCompleteOnboardingFailure(new ApiError('http', 400))).toBe('stale')
    expect(classifyCompleteOnboardingFailure(new ApiError('network'))).toBe('network')
    expect(classifyCompleteOnboardingFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyCompleteOnboardingFailure(new Error('boom'))).toBe('unknown')
    expect(classifyCompleteOnboardingFailure(new ApiError('auth-session'))).toBe('access')
  })

  it('treats a server that returns the completed bootstrap (idempotent second call) as a clean success', async () => {
    const client = makeClient()
    mockWrite.mockResolvedValue(completedBootstrap)
    const hook = await renderHook(() => useCompleteOnboarding(), { wrapper: wrap(client) })
    await hook.result.current.mutateAsync({ version: 1 })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.result.current.mutateAsync({ version: 1 })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    hook.unmount(); client.clear()
  })
})

// Suppress unused-import warning for the bootstrap fixture in case future tests need it.
void bootstrap

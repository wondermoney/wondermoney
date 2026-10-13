import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { notificationPreferencesKey } from './query-keys'
import {
  classifyUpdateNotificationFailure,
  useUpdateNotificationPreferences,
} from './use-notification-preferences'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const state = {
  accountRecovery: { effectiveEnabled: true, storedEnabled: true },
  budgetAlerts: { deliverySupported: true, effectiveEnabled: false, storedEnabled: false },
  growth: { effectiveEnabled: true, storedEnabled: true },
  marketingOptOut: false,
  weeklyInsights: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
}

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('useUpdateNotificationPreferences', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('sends a partial patch and commits the authoritative state into the epoch cache', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    mockWrite.mockImplementation(async (endpoint, options) => {
      expect(endpoint.method).toBe('PATCH')
      options.commit(state)
      return state
    })
    const hook = await renderHook(() => useUpdateNotificationPreferences(), { wrapper: wrap(client) })
    await act(async () => { await hook.result.current.mutateAsync({ budgetAlertsEnabled: true }) })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/v1/user/me/email-notification-preferences' }),
      expect.objectContaining({ body: { budgetAlertsEnabled: true }, commit: expect.any(Function) }),
    )
    expect(client.getQueryData(notificationPreferencesKey(9))).toEqual(state)
    await hook.unmount(); client.clear()
  })

  it('routes MFA failures through access blocking without a retry', async () => {
    const client = new QueryClient()
    mockWrite.mockRejectedValue(new ApiError('mfa-required', 403))
    const hook = await renderHook(() => useUpdateNotificationPreferences(), { wrapper: wrap(client) })
    await act(async () => { await expect(hook.result.current.mutateAsync({ marketingOptOut: true })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies the API 400 guard as an intact-account "unsupported" outcome', () => {
    expect(classifyUpdateNotificationFailure(new ApiError('http', 400))).toBe('unsupported')
    expect(classifyUpdateNotificationFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyUpdateNotificationFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyUpdateNotificationFailure(new ApiError('http', 403))).toBe('access')
    expect(classifyUpdateNotificationFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyUpdateNotificationFailure(new ApiError('cancelled'))).toBe('cancelled')
  })
})

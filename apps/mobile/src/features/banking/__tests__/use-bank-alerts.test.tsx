import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useBankAlertBanner } from '../use-bank-alerts'

const mockRead = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, apiClient: { read: mockRead } }, blockAccess: jest.fn() }),
}))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }))

const getItem = SecureStore.getItemAsync as jest.Mock
const setItem = SecureStore.setItemAsync as jest.Mock

const revoked = { id: 'a1', kind: 'consent_revoked', institutionName: 'Bank', bankId: null, expiresAt: null, daysUntilExpiry: null, failingSince: null } as const
const failing = { ...revoked, id: 'a2', kind: 'sync_failing', failingSince: '2026-11-01T00:00:00.000Z' } as const

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper: Wrapper }
}

describe('useBankAlertBanner', () => {
  beforeEach(() => {
    mockRead.mockReset()
    getItem.mockReset().mockResolvedValue(null)
    setItem.mockReset().mockResolvedValue(undefined)
  })

  it('shows the alerts once remembered dismissals are read, leaving out dismissed ids', async () => {
    mockRead.mockResolvedValue({ alerts: [revoked, failing] })
    getItem.mockResolvedValue('["a1"]')
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankAlertBanner(), { wrapper })
    await waitFor(() => expect(hook.result.current.banner?.primary.id).toBe('a2'))
    expect(hook.result.current.banner?.moreCount).toBe(0)
    await hook.unmount(); client.clear()
  })

  it('dismisses every alert the banner covers and remembers them', async () => {
    mockRead.mockResolvedValue({ alerts: [revoked, failing] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankAlertBanner(), { wrapper })
    await waitFor(() => expect(hook.result.current.banner?.moreCount).toBe(1))
    await act(async () => { hook.result.current.dismiss() })
    expect(hook.result.current.banner).toBeNull()
    await waitFor(() => expect(setItem).toHaveBeenCalledWith('wondermoney.bank-alerts.dismissed', JSON.stringify(['a1', 'a2'])))
    await hook.unmount(); client.clear()
  })

  it('still renders and dismisses for the session when storage fails', async () => {
    mockRead.mockResolvedValue({ alerts: [revoked] })
    getItem.mockRejectedValue(new Error('keychain locked'))
    setItem.mockRejectedValue(new Error('keychain locked'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankAlertBanner(), { wrapper })
    await waitFor(() => expect(hook.result.current.banner?.primary.id).toBe('a1'))
    await act(async () => { hook.result.current.dismiss() })
    expect(hook.result.current.banner).toBeNull()
    await hook.unmount(); client.clear()
  })

  it('reads an older server without this route as no alerts', async () => {
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankAlertBanner(), { wrapper })
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    await waitFor(() => expect(getItem).toHaveBeenCalled())
    expect(hook.result.current.banner).toBeNull()
    await hook.unmount(); client.clear()
  })
})

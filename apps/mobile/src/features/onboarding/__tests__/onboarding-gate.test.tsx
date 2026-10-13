import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useOnboardingGate } from '../onboarding-gate.hook'

const mockRead = jest.fn()
const mockReplace = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, apiClient: { read: mockRead } }, blockAccess: jest.fn() }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, canGoBack: () => true, back: jest.fn() }),
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

const legacyCompleted = {
  onboarding: {
    completed: true,
    completedVersion: 0,
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

describe('useOnboardingGate', () => {
  beforeEach(() => { mockRead.mockReset(); mockReplace.mockReset() })

  it('navigates to /onboarding when the bootstrap resolves required and not completed', async () => {
    const client = new QueryClient()
    mockRead.mockResolvedValue(newUser)
    const hook = await renderHook(() => useOnboardingGate(), { wrapper: wrap(client) })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'))
    expect(hook.result.current.required).toBe(true)
    expect(hook.result.current.completed).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('stays out of the way for legacy users (required:false)', async () => {
    const client = new QueryClient()
    mockRead.mockResolvedValue(legacyCompleted)
    const hook = await renderHook(() => useOnboardingGate(), { wrapper: wrap(client) })
    await waitFor(() => expect(hook.result.current.bootstrapReady).toBe(true))
    expect(mockReplace).not.toHaveBeenCalled()
    expect(hook.result.current.required).toBe(false)
    expect(hook.result.current.completed).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('does not navigate while the bootstrap is still loading', async () => {
    const client = new QueryClient()
    mockRead.mockReturnValue(new Promise(() => { /* never resolves */ }))
    const hook = await renderHook(() => useOnboardingGate(), { wrapper: wrap(client) })
    expect(hook.result.current.bootstrapReady).toBe(false)
    expect(mockReplace).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })
})

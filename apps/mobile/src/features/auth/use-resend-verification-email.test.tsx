import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useResendVerificationEmail } from './use-resend-verification-email'

const mockRead = jest.fn()
const mockSendVerificationEmail = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: 4, apiClient: { read: mockRead } },
    sendVerificationEmail: mockSendVerificationEmail,
  }),
}))

const profile = { profile: { emailAddress: 'person@example.com', firstName: null, lastName: null, mfaEnabled: false } }

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useResendVerificationEmail', () => {
  beforeEach(() => { mockRead.mockReset(); mockSendVerificationEmail.mockReset() })

  it('sends the link to the profile address and resolves with the outcome', async () => {
    mockRead.mockResolvedValue(profile)
    mockSendVerificationEmail.mockResolvedValue({ status: 'sent' })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useResendVerificationEmail(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync()).resolves.toEqual({ status: 'sent' })
    })

    expect(mockSendVerificationEmail).toHaveBeenCalledWith('person@example.com')
    await hook.unmount(); client.clear()
  })

  it('reuses a cached profile instead of fetching it again', async () => {
    mockSendVerificationEmail.mockResolvedValue({ status: 'sent' })
    const { client, wrapper } = setup()
    client.setQueryData(['self', 'profile', 4], profile)
    const hook = await renderHook(() => useResendVerificationEmail(), { wrapper })

    await act(async () => { await hook.result.current.mutateAsync() })

    expect(mockRead).not.toHaveBeenCalled()
    expect(mockSendVerificationEmail).toHaveBeenCalledWith('person@example.com')
    await hook.unmount(); client.clear()
  })

  it('reports unavailable without sending when the profile cannot be read', async () => {
    mockRead.mockRejectedValue(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useResendVerificationEmail(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync()).resolves.toEqual({ status: 'unavailable' })
    })

    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })
})

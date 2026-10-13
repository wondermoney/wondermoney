import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useBankInstitutions } from '../use-bank-institutions'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'PT' }] }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBankInstitutions', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('reads the institutions endpoint with the resolved device country', async () => {
    mockRead.mockResolvedValue([{ id: '1', name: 'Revolut', logo: 'https://logo' }])
    const { wrapper } = setup()
    const hook = await renderHook(() => useBankInstitutions(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/banking/bank?country=PT' })
    expect(hook.result.current.data).toEqual([{ id: '1', name: 'Revolut', logo: 'https://logo' }])
    await hook.unmount()
  })

  it('routes mfa-required into blockAccess', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    const { wrapper } = setup()
    const hook = await renderHook(() => useBankInstitutions(), { wrapper })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    await hook.unmount()
  })

  it('routes mfa-required into blockAccess', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('mfa-required', 401))
    const { wrapper } = setup()
    const hook = await renderHook(() => useBankInstitutions(), { wrapper })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    await hook.unmount()
  })

  it('suppresses data on an invalid-response failure', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('invalid-response'))
    const { wrapper } = setup()
    const hook = await renderHook(() => useBankInstitutions(), { wrapper })
    await waitFor(() => expect(hook.result.current.isInitialFailure).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount()
  })
})

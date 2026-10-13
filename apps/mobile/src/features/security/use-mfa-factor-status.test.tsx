import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useMfaFactorStatus } from './use-mfa-factor-status'

const mockMfaListFactors = jest.fn()
const mockRuntime = { epochId: 7 }
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: mockRuntime, mfaListFactors: mockMfaListFactors }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useMfaFactorStatus', () => {
  beforeEach(() => {
    mockMfaListFactors.mockReset()
  })

  it('reports the verified TOTP factor when one exists', async () => {
    mockMfaListFactors.mockResolvedValue({
      status: 'available',
      totpFactors: [{ id: 'f1', status: 'unverified' }, { id: 'f2', status: 'verified' }],
    })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useMfaFactorStatus(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ hasVerifiedFactor: true, verifiedFactorId: 'f2' }))
    expect(client.getQueryData(['security', 'mfa-factors', 7])).toEqual({ hasVerifiedFactor: true, verifiedFactorId: 'f2' })
    await hook.unmount()
    client.clear()
  })

  it('reports no verified factor when none exists', async () => {
    mockMfaListFactors.mockResolvedValue({ status: 'available', totpFactors: [] })
    const { wrapper } = setup()
    const hook = await renderHook(() => useMfaFactorStatus(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual({ hasVerifiedFactor: false, verifiedFactorId: null }))
    await hook.unmount()
  })

  it('surfaces an error when the adapter reports unavailable', async () => {
    mockMfaListFactors.mockResolvedValue({ status: 'unavailable' })
    const { wrapper } = setup()
    const hook = await renderHook(() => useMfaFactorStatus(), { wrapper })
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount()
  })
})

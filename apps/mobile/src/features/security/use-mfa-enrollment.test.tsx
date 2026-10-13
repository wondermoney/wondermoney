import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useMfaEnrollment } from './use-mfa-enrollment'

const mockMfaEnrollTotp = jest.fn()
const mockMfaChallenge = jest.fn()
const mockMfaVerify = jest.fn()
const mockRuntime = { epochId: 7 }
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: mockRuntime,
    mfaEnrollTotp: mockMfaEnrollTotp,
    mfaChallenge: mockMfaChallenge,
    mfaVerify: mockMfaVerify,
  }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useMfaEnrollment', () => {
  beforeEach(() => {
    mockMfaEnrollTotp.mockReset()
    mockMfaChallenge.mockReset()
    mockMfaVerify.mockReset()
  })

  it('starts enrollment and surfaces the secret for manual entry', async () => {
    mockMfaEnrollTotp.mockResolvedValue({
      status: 'enrolled',
      factorId: 'factor-1',
      totp: { qrCode: 'data:...', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/...' },
    })
    const { wrapper } = setup()
    const hook = await renderHook(() => useMfaEnrollment(), { wrapper })
    await act(async () => {
      await expect(hook.result.current.start.mutateAsync()).resolves.toEqual({
        status: 'enrolled',
        factorId: 'factor-1',
        totp: { qrCode: 'data:...', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/...' },
      })
    })
    await hook.unmount()
  })

  it('confirms enrollment by challenging then verifying the pending factor, and invalidates factor status', async () => {
    mockMfaEnrollTotp.mockResolvedValue({
      status: 'enrolled',
      factorId: 'factor-1',
      totp: { qrCode: 'data:...', secret: 'secret', uri: 'uri' },
    })
    mockMfaChallenge.mockResolvedValue({ status: 'challenged', challengeId: 'challenge-1' })
    mockMfaVerify.mockResolvedValue({ status: 'verified' })
    const { client, wrapper } = setup()
    client.setQueryData(['security', 'mfa-factors', 7], { hasVerifiedFactor: false, verifiedFactorId: null })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useMfaEnrollment(), { wrapper })
    await act(async () => { await hook.result.current.start.mutateAsync() })

    await act(async () => {
      await expect(hook.result.current.confirm.mutateAsync('123456')).resolves.toEqual({ status: 'verified' })
    })

    expect(mockMfaChallenge).toHaveBeenCalledWith('factor-1')
    expect(mockMfaVerify).toHaveBeenCalledWith('factor-1', 'challenge-1', '123456')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['security', 'mfa-factors', 7], exact: true })
    await hook.unmount()
  })

  it('surfaces an invalid code without invalidating factor status', async () => {
    mockMfaEnrollTotp.mockResolvedValue({ status: 'enrolled', factorId: 'factor-1', totp: { qrCode: 'x', secret: 's', uri: 'u' } })
    mockMfaChallenge.mockResolvedValue({ status: 'challenged', challengeId: 'challenge-1' })
    mockMfaVerify.mockResolvedValue({ status: 'invalid-code' })
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useMfaEnrollment(), { wrapper })
    await act(async () => { await hook.result.current.start.mutateAsync() })

    await act(async () => {
      await expect(hook.result.current.confirm.mutateAsync('000000')).resolves.toEqual({ status: 'invalid-code' })
    })

    expect(invalidate).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('reports unavailable when confirming without a factor from a prior successful start', async () => {
    const { wrapper } = setup()
    const hook = await renderHook(() => useMfaEnrollment(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.confirm.mutateAsync('123456')).resolves.toEqual({ status: 'unavailable' })
    })

    expect(mockMfaChallenge).not.toHaveBeenCalled()
    await hook.unmount()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useMfaUnenroll } from './use-mfa-unenroll'

const mockMfaUnenroll = jest.fn()
const mockRuntime = { epochId: 7 }
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: mockRuntime, mfaUnenroll: mockMfaUnenroll }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useMfaUnenroll', () => {
  beforeEach(() => { mockMfaUnenroll.mockReset() })

  it('unenrolls the given factor and invalidates factor status on success', async () => {
    mockMfaUnenroll.mockResolvedValue({ status: 'unenrolled' })
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useMfaUnenroll(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync('factor-1')).resolves.toEqual({ status: 'unenrolled' })
    })

    expect(mockMfaUnenroll).toHaveBeenCalledWith('factor-1')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['security', 'mfa-factors', 7], exact: true })
    await hook.unmount()
  })

  it('leaves factor status cached when unenrollment is unavailable', async () => {
    mockMfaUnenroll.mockResolvedValue({ status: 'unavailable' })
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useMfaUnenroll(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync('factor-1')).resolves.toEqual({ status: 'unavailable' })
    })

    expect(invalidate).not.toHaveBeenCalled()
    await hook.unmount()
  })
})

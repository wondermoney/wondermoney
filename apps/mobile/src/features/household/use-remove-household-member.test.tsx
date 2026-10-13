import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useRemoveHouseholdMember } from './use-remove-household-member'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useRemoveHouseholdMember', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('removes/leaves through the exact endpoint with no body and invalidates after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(2) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/household/members/2' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household', 8], exact: true })
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid appuser key before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(0)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(2)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

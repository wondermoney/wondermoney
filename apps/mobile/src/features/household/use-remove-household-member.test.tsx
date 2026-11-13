import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useRemoveHouseholdMember } from './use-remove-household-member'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const mockSignOut = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess, signOut: mockSignOut }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useRemoveHouseholdMember', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset(); mockSignOut.mockReset().mockResolvedValue(undefined) })

  it('removes a member through the exact endpoint with no body, invalidates, and stays signed in', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ appuserKey: 2, leaving: false }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/household/members/2' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household', 8], exact: true })
    expect(mockSignOut).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('signs out after leaving, since the person has no household until they sign in again', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ appuserKey: 3, leaving: true }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/household/members/3' })
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('does not sign out when leaving fails', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('http', 403))
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ appuserKey: 3, leaving: true })).rejects.toThrow() })
    expect(mockSignOut).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid appuser key before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ appuserKey: 0, leaving: false })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useRemoveHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ appuserKey: 2, leaving: false })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

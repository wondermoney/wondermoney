import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useHouseholdMemberRole } from './use-household-member-role'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const household = {
  members: [
    { appuserKey: 2, emailAddress: 'b@x.test', firstName: 'Bea', role: 'owner' as const },
    { appuserKey: 1, emailAddress: 'a@x.test', firstName: 'Ana', role: 'admin' as const },
  ],
  maxMembers: 6,
  pendingInvites: [],
  viewerAppuserKey: 1,
}

describe('useHouseholdMemberRole', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('PATCHes the member with only the new role and invalidates the household', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ member: {} }); return undefined })
    const hook = await renderHook(() => useHouseholdMemberRole(), { wrapper })
    await act(async () => { await hook.result.current.changeRole.mutateAsync({ appuserKey: 4, role: 'viewer' }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/household/members/4' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ role: 'viewer' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household', 8], exact: true })
    await hook.unmount(); client.clear()
  })

  it('never PATCHes owner as a role', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHouseholdMemberRole(), { wrapper })
    await act(async () => {
      await expect(hook.result.current.changeRole.mutateAsync({ appuserKey: 4, role: 'owner' as never })).rejects.toThrow()
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('transfers ownership with the target key and caches the household the API answers with', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(household); return household })
    const hook = await renderHook(() => useHouseholdMemberRole(), { wrapper })
    await act(async () => { await hook.result.current.transferOwnership.mutateAsync(2) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/household/transfer-ownership' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ appuserKey: 2 })
    expect(client.getQueryData(['household', 8])).toEqual(household)
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useHouseholdMemberRole(), { wrapper })
    await act(async () => { await expect(hook.result.current.transferOwnership.mutateAsync(2)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

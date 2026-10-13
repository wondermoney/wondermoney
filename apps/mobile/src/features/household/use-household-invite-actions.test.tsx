import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useHouseholdInviteActions } from './use-household-invite-actions'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useHouseholdInviteActions', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('resends through the exact endpoint and invalidates the household query after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useHouseholdInviteActions(), { wrapper })
    await act(async () => { await hook.result.current.resend.mutateAsync(5) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/household/invites/5/resend' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household', 8], exact: true })
    await hook.unmount(); client.clear()
  })

  it('revokes through the exact endpoint with no body and invalidates after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useHouseholdInviteActions(), { wrapper })
    await act(async () => { await hook.result.current.revoke.mutateAsync(5) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/household/invites/5' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household', 8], exact: true })
    await hook.unmount(); client.clear()
  })

  it('blocks access independently for resend and revoke on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useHouseholdInviteActions(), { wrapper })
    await act(async () => { await expect(hook.result.current.resend.mutateAsync(5)).rejects.toMatchObject({ code: 'mfa-required' }) })
    await act(async () => { await expect(hook.result.current.revoke.mutateAsync(5)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })
})

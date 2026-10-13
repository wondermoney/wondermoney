import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useInviteHouseholdMember } from './use-invite-household-member'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useInviteHouseholdMember', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('trims and lowercases the email, and invalidates the household query after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useInviteHouseholdMember(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('  Partner@Example.com  ') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/household/invites' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ email: 'partner@example.com' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household', 8], exact: true })
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid email before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useInviteHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('not-an-email')).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useInviteHouseholdMember(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('a@b.co')).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

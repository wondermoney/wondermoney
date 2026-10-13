import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyAccountDeleteFailure, useAccountDeleteMutation } from './use-account-delete-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useAccountDeleteMutation', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('deletes with no body and invalidates the accounts list and detail after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useAccountDeleteMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(12) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/account/12' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 8, 12], exact: true })
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid account id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAccountDeleteMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(0)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useAccountDeleteMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(12)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures and defaults unknown errors to general', () => {
    expect(classifyAccountDeleteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyAccountDeleteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyAccountDeleteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyAccountDeleteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyAccountDeleteFailure(new ApiError('invalid-response'))).toBe('invalid')
    expect(classifyAccountDeleteFailure(new ApiError('http', 500))).toBe('general')
    expect(classifyAccountDeleteFailure(new Error('boom'))).toBe('general')
  })
})

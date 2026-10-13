import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyBankConnectionDisconnectFailure, useBankConnectionDisconnectMutation } from '../use-bank-connection-disconnect-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBankConnectionDisconnectMutation', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('disconnects with no body and invalidates the connections list after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBankConnectionDisconnectMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(42) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/banking/connections/42' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['banking', 8, 'connections'], exact: true })
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid connection id before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useBankConnectionDisconnectMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(0)).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useBankConnectionDisconnectMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(42)).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies known failures and defaults unknown errors to general', () => {
    expect(classifyBankConnectionDisconnectFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyBankConnectionDisconnectFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyBankConnectionDisconnectFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyBankConnectionDisconnectFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyBankConnectionDisconnectFailure(new ApiError('invalid-response'))).toBe('invalid')
    expect(classifyBankConnectionDisconnectFailure(new ApiError('http', 500))).toBe('general')
    expect(classifyBankConnectionDisconnectFailure(new Error('boom'))).toBe('general')
  })
})

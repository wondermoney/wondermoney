import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyStartBankConnectionFailure, useStartBankConnection } from '../use-start-bank-connection'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useStartBankConnection', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('reads the start-connection endpoint for the chosen bank id and returns the redirectUrl', async () => {
    mockRead.mockResolvedValue({ redirectUrl: 'https://ob.gocardless.com/session/abc' })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStartBankConnection(), { wrapper })
    let result: unknown
    await act(async () => { result = await hook.result.current.mutateAsync('REVOLUT_REVOGB21') })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/banking/bank/REVOLUT_REVOGB21/start?returnTo=mobile' })
    expect(result).toEqual({ redirectUrl: 'https://ob.gocardless.com/session/abc' })
    await hook.unmount(); client.clear()
  })

  it('rejects a concurrent start while one is already in flight', async () => {
    const { client, wrapper } = setup()
    let resolve!: (value: { redirectUrl: string }) => void
    mockRead.mockReturnValue(new Promise((done) => { resolve = done }))
    const hook = await renderHook(() => useStartBankConnection(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync('bank-1') })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    await act(async () => {
      await expect(hook.result.current.mutateAsync('bank-2')).rejects.toThrow(/already starting/i)
    })
    expect(mockRead).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ redirectUrl: 'https://ob.gocardless.com/session/abc' }); await first })
    await hook.unmount(); client.clear()
  })

  it('routes mfa-required into blockAccess', async () => {
    mockRead.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStartBankConnection(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('bank-1')).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

describe('classifyStartBankConnectionFailure', () => {
  it('classifies mfa, access, not-found, unavailable, and general failures distinctly', () => {
    expect(classifyStartBankConnectionFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyStartBankConnectionFailure(new ApiError('http', 403))).toBe('access')
    expect(classifyStartBankConnectionFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyStartBankConnectionFailure(new ApiError('network'))).toBe('unavailable')
    expect(classifyStartBankConnectionFailure(new ApiError('http', 502))).toBe('unavailable')
    expect(classifyStartBankConnectionFailure(new ApiError('http', 418))).toBe('general')
    expect(classifyStartBankConnectionFailure(new Error('boom'))).toBe('general')
  })
})

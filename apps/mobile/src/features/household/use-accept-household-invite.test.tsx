import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useAcceptHouseholdInvite } from './use-accept-household-invite'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useAcceptHouseholdInvite', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('POSTs accept for the token with no body and resets every query after commit', async () => {
    const { client, wrapper } = setup()
    const reset = jest.spyOn(client, 'resetQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useAcceptHouseholdInvite(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync('tok/1') })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/household/invites/tok%2F1/accept' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(reset).toHaveBeenCalledWith()
    await hook.unmount(); client.clear()
  })

  it('does not reset anything when the join is refused', async () => {
    const { client, wrapper } = setup()
    const reset = jest.spyOn(client, 'resetQueries')
    mockWrite.mockRejectedValue(new ApiError('http', 409, { serverCode: 'household_has_data' }))
    const hook = await renderHook(() => useAcceptHouseholdInvite(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('tok')).rejects.toMatchObject({ serverCode: 'household_has_data' }) })
    expect(reset).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('rejects a blank token before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useAcceptHouseholdInvite(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync('  ')).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })
})

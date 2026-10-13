import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useBudgetAccounts } from './use-budget-accounts'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpoch = 6
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useBudgetAccounts', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset(); mockEpoch = 6 })

  it('loads the linked accounts with an epoch-isolated conservative GET', async () => {
    const { client, wrapper } = setup()
    mockRead.mockResolvedValue({ accounts: [{ accountKey: 9, accountName: 'Daily account' }] })
    const hook = await renderHook(() => useBudgetAccounts(7), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.accounts).toHaveLength(1))
    expect(mockRead.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/v1/budget/7/accounts' })
    expect(client.getQueryCache().find({ queryKey: ['budgets', 'accounts', 6, 7] })?.options).toMatchObject({ retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false })
    await hook.unmount(); client.clear()
  })

  it('does not request invalid ids and classifies not-found and access transitions', async () => {
    const { client, wrapper } = setup()
    const invalid = await renderHook(() => useBudgetAccounts(null), { wrapper })
    expect(invalid.result.current.isInvalidRoute).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await invalid.unmount()

    mockRead.mockRejectedValueOnce(new ApiError('http', 404))
    const missing = await renderHook(() => useBudgetAccounts(7), { wrapper })
    await waitFor(() => expect(missing.result.current.isNotFound).toBe(true))
    await missing.unmount(); client.clear()

    const accessSetup = setup()
    mockRead.mockRejectedValueOnce(new ApiError('mfa-required'))
    const access = await renderHook(() => useBudgetAccounts(7), { wrapper: accessSetup.wrapper })
    await waitFor(() => expect(access.result.current.isAccessTransition).toBe(true))
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await access.unmount(); accessSetup.client.clear()
  })
})

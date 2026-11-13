import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { freezeSpentBy } from './transactions-contract'
import { useEditTransactionAttribution } from './use-edit-transaction-attribution'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

describe('freezeSpentBy', () => {
  it('sends a member key, "shared", or null for the account default', () => {
    expect(freezeSpentBy({ transactionId: 4, attributedAppuserKey: 9 }).payload).toEqual({ attributedAppuserKey: 9 })
    expect(freezeSpentBy({ transactionId: 4, attributedAppuserKey: 'shared' }).payload).toEqual({ attributedAppuserKey: 'shared' })
    expect(freezeSpentBy({ transactionId: 4, attributedAppuserKey: null }).payload).toEqual({ attributedAppuserKey: null })
  })

  it('refuses anything else', () => {
    expect(() => freezeSpentBy({ transactionId: 4, attributedAppuserKey: 0 })).toThrow()
    expect(() => freezeSpentBy({ transactionId: 0, attributedAppuserKey: 9 })).toThrow()
  })
})

describe('useEditTransactionAttribution', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it.each([
    ['a member', 9],
    ['Shared', 'shared'],
    ['the account default', null],
  ] as const)('patches the transaction to %s and refreshes what a member filter reads', async (_label, value) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const keys = [
      ['transactions', 12, 'aggregate'], ['account-insights', 12, 'cashflow'], ['budgets', 'list', 12], ['reports', 12, 'sankey'],
      ['reports', 11, 'cashflow'], ['goals', 12],
    ]
    const invalidated: unknown[][] = []
    jest.spyOn(client, 'invalidateQueries').mockImplementation(async (filters) => {
      keys.forEach((key) => { if (filters?.predicate?.({ queryKey: key } as never)) invalidated.push(key) })
    })
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionAttribution(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ transactionId: 42, attributedAppuserKey: value }) })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/v1/account/transaction/42' }),
      expect.objectContaining({ body: { attributedAppuserKey: value } }),
    )
    expect(invalidated).toEqual(keys.slice(0, 4))
    await hook.unmount()
    client.clear()
  })
})

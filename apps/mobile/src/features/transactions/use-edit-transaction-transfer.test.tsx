import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { freezeTransferEdit } from './transactions-contract'
import { useEditTransactionTransfer } from './use-edit-transaction-transfer'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

describe('freezeTransferEdit', () => {
  it('types money out as an outgoing transfer, with its destination', () => {
    expect(freezeTransferEdit({ transactionId: 4, direction: 'debit', transfer: true, destination: { type: 'portfolio', key: 9 } }).payload)
      .toEqual({ transactionType: 'TRANSFER_OUT', transferDestination: { type: 'portfolio', key: 9 } })
  })

  it('types money in as an incoming transfer, which has no destination', () => {
    expect(freezeTransferEdit({ transactionId: 4, direction: 'credit', transfer: true }).payload).toEqual({ transactionType: 'TRANSFER_IN' })
    expect(() => freezeTransferEdit({ transactionId: 4, direction: 'credit', transfer: true, destination: { type: 'goal', key: 1 } })).toThrow()
  })

  it('undoes a transfer back to the type of its direction', () => {
    expect(freezeTransferEdit({ transactionId: 4, direction: 'debit', transfer: false }).payload).toEqual({ transactionType: 'PAYMENT' })
    expect(freezeTransferEdit({ transactionId: 4, direction: 'credit', transfer: false }).payload).toEqual({ transactionType: 'DEPOSIT' })
  })

  it('sends an explicit null to clear a destination', () => {
    expect(freezeTransferEdit({ transactionId: 4, direction: 'debit', transfer: true, destination: null }).payload)
      .toEqual({ transactionType: 'TRANSFER_OUT', transferDestination: null })
  })
})

describe('useEditTransactionTransfer', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('patches the transaction and refreshes lists, balances, budgets and reports of this session only', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const keys = [
      ['transactions', 12, 'aggregate'], ['account-insights', 12, 'cashflow'], ['budgets', 'list', 12],
      ['reports', 12, 'spending-by-category'], ['reports', 11, 'cashflow'], ['goals', 12],
    ]
    const invalidated: unknown[][] = []
    jest.spyOn(client, 'invalidateQueries').mockImplementation(async (filters) => {
      keys.forEach((key) => { if (filters?.predicate?.({ queryKey: key } as never)) invalidated.push(key) })
    })
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useEditTransactionTransfer(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ transactionId: 42, direction: 'debit', transfer: true, destination: { type: 'account', key: 3 } }) })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/v1/account/transaction/42' }),
      expect.objectContaining({ body: { transactionType: 'TRANSFER_OUT', transferDestination: { type: 'account', key: 3 } } }),
    )
    expect(invalidated).toEqual(keys.slice(0, 4))
    await hook.unmount()
    client.clear()
  })
})

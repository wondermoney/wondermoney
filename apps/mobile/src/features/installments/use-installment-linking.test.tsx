import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { planDetailFixture } from './test-fixtures'
import { useInstallmentLinking } from './use-installment-linking'

const mockRead = jest.fn()
const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: jest.fn() }),
}))

const charge = (transactionKey: number, day: string, settlementAmount: number) => ({
  transactionKey,
  transactionDate: `${day}T00:00:00.000Z`,
  settlementAmount,
  description: `Row ${transactionKey}`,
  hidden: false,
  installment: null,
})

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useInstallmentLinking', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset() })

  it('searches the card for the open installment and offers its close charges', async () => {
    mockRead.mockResolvedValue({ transactions: [charge(904, '2026-11-06', -25), charge(905, '2026-11-07', -80)] })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useInstallmentLinking(planDetailFixture), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()

    await act(async () => { hook.result.current.open(3) })
    await waitFor(() => expect(hook.result.current.candidates.status).toBe('loaded'))
    const path: string = mockRead.mock.calls[0][0].path
    expect(path).toMatch(/^\/v1\/account\/7\/transaction\?/)
    expect(path).toContain('direction=out')
    expect(path).toContain('statuses=BOOKED')
    expect(path).toContain('limit=500')
    expect(path).toContain(`fromDate=${Date.parse('2026-10-05T00:00:00.000Z')}`)
    expect(hook.result.current.target).toBe(3)
    const rows = () => (hook.result.current.candidates.status === 'loaded' ? hook.result.current.candidates.rows : [])
    expect(rows().map((row) => row.transactionKey)).toEqual([904])

    await act(async () => { hook.result.current.toggleShowAllAmounts() })
    expect(rows().map((row) => row.transactionKey)).toEqual([904, 905])
    await hook.unmount(); client.clear()
  })

  it('links the chosen transaction and closes the picker', async () => {
    mockRead.mockResolvedValue({ transactions: [charge(904, '2026-11-06', -25)] })
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ installmentPlan: planDetailFixture }); return { installmentPlan: planDetailFixture } })
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useInstallmentLinking(planDetailFixture), { wrapper })
    await act(async () => { hook.result.current.open(3) })
    await act(async () => { await hook.result.current.link(904) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/installment-plans/11/installments/3/link' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ transactionKey: 904 })
    expect(hook.result.current.target).toBeNull()
    expect(hook.result.current.failure).toBeNull()
    await hook.unmount(); client.clear()
  })

  it('keeps the picker open and says why a link was refused', async () => {
    mockRead.mockResolvedValue({ transactions: [charge(904, '2026-11-06', -25)] })
    mockWrite.mockRejectedValue(new ApiError('http', 400))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useInstallmentLinking(planDetailFixture), { wrapper })
    await act(async () => { hook.result.current.open(3) })
    await act(async () => { await hook.result.current.link(904) })
    expect(hook.result.current.target).toBe(3)
    expect(hook.result.current.failure).toBe('installments.link.failures.wrongCard')
    await hook.unmount(); client.clear()
  })

  it('unlinks, and names a failed unlink', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useInstallmentLinking(planDetailFixture), { wrapper })
    await act(async () => { await hook.result.current.unlink(1) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/installment-plans/11/installments/1/link' })
    expect(hook.result.current.failure).toBe('installments.failures.network')
    await hook.unmount(); client.clear()
  })
})

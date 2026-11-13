import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import {
  classifyInstallmentWriteFailure,
  installmentLinkFailureMessage,
  useCreateInstallmentPlan,
  useDeleteInstallmentPlan,
  useLinkInstallment,
  useUnlinkInstallment,
} from './use-installment-plan-mutations'
import { installmentPlanDetailKey, installmentPlansKey } from './query-keys'
import { planDetailFixture } from './test-fixtures'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const payload = { accountKey: 7, description: 'Phone shop', purchaseDate: '2026-09-15', totalAmount: 300, installmentCount: 6, links: [{ transactionKey: 901, installmentNumber: 1 }] }

describe('installment plan mutations', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('posts the plan with its links and refreshes plans, commitments, suggestions, transactions and the forecast', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ installmentPlan: planDetailFixture }); return { installmentPlan: planDetailFixture } })
    const hook = await renderHook(() => useCreateInstallmentPlan(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(payload) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/installment-plans' })
    expect(mockWrite.mock.calls[0][1].body).toEqual(payload)
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['installment-plans', 8] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 8] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 8, 7, 'forecast'] })
    await hook.unmount(); client.clear()
  })

  it('never sends a plan the API would refuse', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCreateInstallmentPlan(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ ...payload, installmentCount: 1 })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('deletes a plan without refetching its own page', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useDeleteInstallmentPlan(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ planId: 11, accountId: 7 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/installment-plans/11' })
    const filter = invalidate.mock.calls.find(([options]) => options?.queryKey?.[0] === 'installment-plans')?.[0]
    const matches = (queryKey: readonly unknown[]) => filter?.predicate?.({ queryKey } as never) ?? true
    expect(matches(installmentPlanDetailKey(8, 11))).toBe(false)
    expect(matches(installmentPlanDetailKey(8, 12))).toBe(true)
    expect(matches(installmentPlansKey(8, 7))).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('blocks access on an MFA rejection and classifies failures', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useDeleteInstallmentPlan(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ planId: 11, accountId: 7 })).rejects.toMatchObject({ code: 'mfa-required' }) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    expect(classifyInstallmentWriteFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyInstallmentWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyInstallmentWriteFailure(new ApiError('http', 409))).toBe('conflict')
    expect(classifyInstallmentWriteFailure(new ApiError('network'))).toBe('network')
    expect(classifyInstallmentWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyInstallmentWriteFailure(new Error('boom'))).toBe('general')
    await hook.unmount(); client.clear()
  })

  it('links a transaction to an installment, puts the answer on the plan page and refreshes the card', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ installmentPlan: planDetailFixture }); return { installmentPlan: planDetailFixture } })
    const hook = await renderHook(() => useLinkInstallment(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ planId: 11, accountId: 7, installmentNumber: 3, transactionKey: 904 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/installment-plans/11/installments/3/link' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ transactionKey: 904 })
    expect(client.getQueryData(installmentPlanDetailKey(8, 11))).toEqual({ installmentPlan: planDetailFixture })
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['installment-plans', 8] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 8] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 8, 7, 'forecast'] })
    await hook.unmount(); client.clear()
  })

  it('unlinks an installment', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ installmentPlan: planDetailFixture }); return { installmentPlan: planDetailFixture } })
    const hook = await renderHook(() => useUnlinkInstallment(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ planId: 11, accountId: 7, installmentNumber: 1 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/installment-plans/11/installments/1/link' })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    await hook.unmount(); client.clear()
  })

  it('refreshes after a conflict, which means the page was out of date, but not after a wrong card', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useLinkInstallment(), { wrapper })
    mockWrite.mockRejectedValueOnce(new ApiError('http', 400))
    await act(async () => { await expect(hook.result.current.mutateAsync({ planId: 11, accountId: 7, installmentNumber: 3, transactionKey: 904 })).rejects.toBeInstanceOf(ApiError) })
    expect(invalidate).not.toHaveBeenCalled()
    mockWrite.mockRejectedValueOnce(new ApiError('http', 409))
    await act(async () => { await expect(hook.result.current.mutateAsync({ planId: 11, accountId: 7, installmentNumber: 3, transactionKey: 904 })).rejects.toBeInstanceOf(ApiError) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 8] })
    await hook.unmount(); client.clear()
  })

  it('names each refusal of the link endpoint', () => {
    expect(installmentLinkFailureMessage('invalid', 'link')).toBe('installments.link.failures.wrongCard')
    expect(installmentLinkFailureMessage('conflict', 'link')).toBe('installments.link.failures.alreadyLinked')
    expect(installmentLinkFailureMessage('not-found', 'unlink')).toBe('installments.link.failures.notFound')
    expect(installmentLinkFailureMessage('general', 'link')).toBe('installments.link.failures.linkFailed')
    expect(installmentLinkFailureMessage('general', 'unlink')).toBe('installments.link.failures.unlinkFailed')
    expect(installmentLinkFailureMessage('network', 'link')).toBe('installments.failures.network')
    expect(installmentLinkFailureMessage('demo', 'unlink')).toBe('installments.failures.demo')
  })
})

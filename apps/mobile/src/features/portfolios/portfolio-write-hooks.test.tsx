import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useCreatePortfolio } from './use-create-portfolio'
import { usePortfolioSettings } from './use-portfolio-settings'

const mockWrite = jest.fn(); const mockBlockAccess = jest.fn(); let mockEpoch = 8
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))
const setup = () => { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } }); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> } }
const createPayload = { name: 'Future', currencyId: 151 }
const metadata = { portfolio: { portfolioKey: 7, name: 'Future', description: null, currencyKey: { code: 'EUR' } } }

describe('portfolio writes', () => {
  beforeEach(() => { mockEpoch = 8; mockWrite.mockReset(); mockBlockAccess.mockReset() })
  it('posts once and invalidates exact current-epoch create families only after commit', async () => {
    const { client, wrapper } = setup(); const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(); return { portfolioId: 7 } })
    const hook = await renderHook(() => useCreatePortfolio(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(createPayload) })
    expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/portfolio' }); expect(mockWrite.mock.calls[0][1].body).toEqual(createPayload)
    expect(invalidate).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolios', 8], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio-dashboard', 8, 'aggregate', 'YTD'], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8], exact: true })
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['portfolio', 8, 7] })); expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['portfolios', 7] }))
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await hook.unmount(); client.clear()
  })
  it('persists an unknown create across remount and blocks another POST in the epoch', async () => {
    const { client, wrapper } = setup(); mockWrite.mockRejectedValue(new ApiError('network'))
    const first = await renderHook(() => useCreatePortfolio(), { wrapper }); await act(async () => { await expect(first.result.current.mutateAsync(createPayload)).rejects.toBeInstanceOf(ApiError) }); await waitFor(() => expect(first.result.current.unknownOutcome?.payload).toEqual(createPayload)); await first.unmount()
    const second = await renderHook(() => useCreatePortfolio(), { wrapper }); expect(second.result.current.unknownOutcome?.payload).toEqual(createPayload); await act(async () => { await expect(second.result.current.mutateAsync(createPayload)).rejects.toBeInstanceOf(ApiError) }); expect(mockWrite).toHaveBeenCalledTimes(1); await second.unmount(); client.clear()
  })
  it('puts only sparse settings and excludes every destructive or financial family from invalidation', async () => {
    const { client, wrapper } = setup(); const invalidate = jest.spyOn(client, 'invalidateQueries'); mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(); return metadata })
    const hook = await renderHook(() => usePortfolioSettings(7), { wrapper }); await act(async () => { await hook.result.current.mutateAsync({ name: 'Future', description: null }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PUT', path: '/v1/portfolio/7' }); expect(mockWrite.mock.calls[0][1].body).toEqual({ name: 'Future', description: null }); expect(invalidate).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolios', 8], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio', 8, 7], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio-dashboard', 8, 'aggregate', 'YTD'], exact: true })
    for (const key of [['net-worth', 8], ['portfolio-holdings', 8, 7], ['portfolio-activity', 8, 7], ['transactions', 8]]) expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: key }))
    await hook.unmount(); client.clear()
  })
  it('retains ambiguous settings payload across remount until a definitive reconciliation is acknowledged', async () => {
    const { client, wrapper } = setup(); mockWrite.mockRejectedValue(new ApiError('invalid-response')); const first = await renderHook(() => usePortfolioSettings(7), { wrapper }); await act(async () => { await expect(first.result.current.mutateAsync({ description: null })).rejects.toBeInstanceOf(ApiError) }); await waitFor(() => expect(first.result.current.unknownOutcome?.payload).toEqual({ description: null })); await first.unmount()
    const second = await renderHook(() => usePortfolioSettings(7), { wrapper }); expect(second.result.current.unknownOutcome?.payload).toEqual({ description: null }); await act(async () => { await expect(second.result.current.mutateAsync({ name: 'Again' })).rejects.toBeInstanceOf(ApiError) }); expect(mockWrite).toHaveBeenCalledTimes(1); await act(async () => { second.result.current.acknowledgeReconciliation('not-applied') }); await waitFor(() => expect(second.result.current.unknownOutcome).toBeNull()); await second.unmount(); client.clear()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useCreatePortfolio } from './use-create-portfolio'
import { useLinkPortfolioAccount } from './use-portfolio-account-link'
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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolios', 8], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio-dashboard', 8, 'aggregate'] }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8], exact: true })
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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolios', 8], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio', 8, 7], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio-dashboard', 8, 'aggregate'] })
    for (const key of [['net-worth', 8], ['portfolio-holdings', 8, 7], ['portfolio-activity', 8, 7], ['transactions', 8]]) expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: key }))
    await hook.unmount(); client.clear()
  })
  it('retains ambiguous settings payload across remount until a definitive reconciliation is acknowledged', async () => {
    const { client, wrapper } = setup(); mockWrite.mockRejectedValue(new ApiError('invalid-response')); const first = await renderHook(() => usePortfolioSettings(7), { wrapper }); await act(async () => { await expect(first.result.current.mutateAsync({ description: null })).rejects.toBeInstanceOf(ApiError) }); await waitFor(() => expect(first.result.current.unknownOutcome?.payload).toEqual({ description: null })); await first.unmount()
    const second = await renderHook(() => usePortfolioSettings(7), { wrapper }); expect(second.result.current.unknownOutcome?.payload).toEqual({ description: null }); await act(async () => { await expect(second.result.current.mutateAsync({ name: 'Again' })).rejects.toBeInstanceOf(ApiError) }); expect(mockWrite).toHaveBeenCalledTimes(1); await act(async () => { second.result.current.acknowledgeReconciliation('not-applied') }); await waitFor(() => expect(second.result.current.unknownOutcome).toBeNull()); await second.unmount(); client.clear()
  })
  it('a settings save that changes the link also refreshes net worth and its history', async () => {
    const { client, wrapper } = setup(); const invalidate = jest.spyOn(client, 'invalidateQueries'); mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(); return metadata })
    const hook = await renderHook(() => usePortfolioSettings(7), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ accountLink: { accountId: 3, mode: 'includes_holdings' } }) })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ accountLink: { accountId: 3, mode: 'includes_holdings' } })
    // Not exact: ['net-worth', 8, 'history', months] is under it.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolios', 8], exact: true })
    await hook.unmount(); client.clear()
  })
  it('unlinks through settings with an explicit null and refreshes net worth', async () => {
    const { client, wrapper } = setup(); const invalidate = jest.spyOn(client, 'invalidateQueries'); mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(); return metadata })
    const hook = await renderHook(() => usePortfolioSettings(7), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ accountLink: null }) })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ accountLink: null })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    await hook.unmount(); client.clear()
  })
  it('refreshes net worth when a retained link is confirmed applied', async () => {
    const { client, wrapper } = setup(); mockWrite.mockRejectedValue(new ApiError('network'))
    const hook = await renderHook(() => usePortfolioSettings(7), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ accountLink: null })).rejects.toBeInstanceOf(ApiError) })
    await waitFor(() => expect(hook.result.current.unknownOutcome?.payload).toEqual({ accountLink: null }))
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    await act(async () => { hook.result.current.acknowledgeReconciliation('applied') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    await hook.unmount(); client.clear()
  })
  it('links from the suggestion with only the link, then refreshes the portfolio, its lists and net worth', async () => {
    const { client, wrapper } = setup(); const invalidate = jest.spyOn(client, 'invalidateQueries'); mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(); return metadata })
    const hook = await renderHook(() => useLinkPortfolioAccount(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ portfolioId: 7, accountLink: { accountId: 3, mode: 'cash_only' } }) })
    expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PUT', path: '/v1/portfolio/7' }); expect(mockWrite.mock.calls[0][1].body).toEqual({ accountLink: { accountId: 3, mode: 'cash_only' } })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolios', 8], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio', 8, 7], exact: true }); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['portfolio-dashboard', 8, 'aggregate'] })
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await hook.unmount(); client.clear()
  })
  it('leaves net worth alone when the other member holds the link, and refreshes it when the outcome is unknown', async () => {
    const { client, wrapper } = setup(); const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockRejectedValueOnce(new ApiError('portfolio-link-held', 403, { linkedBy: 'Ana' }))
    const hook = await renderHook(() => useLinkPortfolioAccount(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ portfolioId: 7, accountLink: { accountId: 3, mode: 'cash_only' } })).rejects.toMatchObject({ code: 'portfolio-link-held', linkedBy: 'Ana' }) })
    expect(invalidate).not.toHaveBeenCalled()
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    await act(async () => { await expect(hook.result.current.mutateAsync({ portfolioId: 7, accountLink: { accountId: 3, mode: 'cash_only' } })).rejects.toBeInstanceOf(ApiError) })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] }))
    await hook.unmount(); client.clear()
  })
  it('asks for verification when the write needs it', async () => {
    const { client, wrapper } = setup(); mockWrite.mockRejectedValue(new ApiError('mfa-required', 401))
    const hook = await renderHook(() => useLinkPortfolioAccount(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ portfolioId: 7, accountLink: null })).rejects.toBeInstanceOf(ApiError) })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    await hook.unmount(); client.clear()
  })
})

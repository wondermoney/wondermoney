import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { assetFixture } from './test-fixtures'
import { classifyManualAssetWriteFailure, useCreateManualAsset, useDeleteManualAsset, useRecordValuation, useUpdateManualAsset } from './use-manual-asset-writes'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const payload = { name: 'Family home', kind: 'property' as const, currencyKey: 1, value: 250_000, valuationDate: '2026-11-10', isPrivate: false }

describe('manual asset writes', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('adds an asset and, once committed, refreshes the list and the whole net worth family', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: assetFixture } })
    const hook = await renderHook(() => useCreateManualAsset(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(payload) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/manual-assets', successStatuses: [201] })
    expect(mockWrite.mock.calls[0][1].body).toEqual(payload)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'list', 8], exact: true })
    // Not exact: net worth today and its history both live under ['net-worth', epoch].
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    await hook.unmount(); client.clear()
  })

  it('sends a yearly change with its start date when adding an asset', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: assetFixture } })
    const hook = await renderHook(() => useCreateManualAsset(), { wrapper })
    const growing = { ...payload, growthRule: { annualRatePercent: 2, startDate: '2027-01-01' } }
    await act(async () => { await hook.result.current.mutateAsync(growing) })
    expect(mockWrite.mock.calls[0][1].body).toEqual(growing)
    await act(async () => { await expect(hook.result.current.mutateAsync({ ...payload, growthRule: { annualRatePercent: 2, startDate: 'soon' } })).rejects.toThrow() })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('records a valuation on the asset and refreshes that asset too, never touching transactions', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return {} })
    const hook = await renderHook(() => useRecordValuation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 7, value: { value: 265_000, date: '2026-11-10' } }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/manual-assets/7/valuations' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ value: 265_000, date: '2026-11-10' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 7], exact: true })
    expect(invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey).includes('transactions'))).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('rejects a negative value before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useRecordValuation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 7, value: { value: -1, date: '2026-11-10' } })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('hands an MFA challenge to the access gate', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required'))
    const hook = await renderHook(() => useCreateManualAsset(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  // Every loan query of epoch 8, as the predicate filter sees it.
  const loanQueries = (invalidate: jest.SpyInstance) => invalidate.mock.calls
    .map(([filters]) => filters?.predicate)
    .filter((predicate): predicate is (query: { queryKey: readonly unknown[] }) => boolean => typeof predicate === 'function')

  it('edits an asset, sending only the change, and refreshes it, the list, net worth and the loans secured against it', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: assetFixture } })
    const hook = await renderHook(() => useUpdateManualAsset(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 7, value: { name: 'Beach house', purchasePrice: null } }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/manual-assets/7', successStatuses: [200] })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ name: 'Beach house', purchasePrice: null })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 7], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    const [loans] = loanQueries(invalidate)
    expect(loans({ queryKey: ['loans', 'list', 8] })).toBe(true)
    expect(loans({ queryKey: ['loans', 'detail', 8, 3] })).toBe(true)
    expect(loans({ queryKey: ['loans', 'list', 9] })).toBe(false)
    expect(loans({ queryKey: ['manual-assets', 'list', 8] })).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('archives through the same PATCH', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: assetFixture } })
    const hook = await renderHook(() => useUpdateManualAsset(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 7, value: { archived: true } }) })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ archived: true })
    await hook.unmount(); client.clear()
  })

  it('rejects an invalid edit, or an empty one, before ever calling write', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useUpdateManualAsset(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 7, value: { name: '  ' } })).rejects.toThrow() })
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 7, value: {} })).rejects.toThrow() })
    // The currency and the value are not editable here.
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 7, value: { currencyKey: 2 } as never })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('deletes an asset and refreshes the list, net worth and the loans that lose their link, not the gone asset', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined) })
    const hook = await renderHook(() => useDeleteManualAsset(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 7 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/manual-assets/7', successStatuses: [204] })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 7], exact: true })
    expect(loanQueries(invalidate)[0]({ queryKey: ['loans', 'overview', 8] })).toBe(true)
    await hook.unmount(); client.clear()
  })

  it("refreshes nothing when the demo refuses a write, and says it was the demo", async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockRejectedValue(new ApiError('demo-forbidden'))
    const update = await renderHook(() => useUpdateManualAsset(), { wrapper })
    let failure: unknown
    await act(async () => { failure = await update.result.current.mutateAsync({ assetId: 7, value: { archived: true } }).catch((error: unknown) => error) })
    expect(classifyManualAssetWriteFailure(failure)).toBe('demo')
    const remove = await renderHook(() => useDeleteManualAsset(), { wrapper })
    await act(async () => { failure = await remove.result.current.mutateAsync({ assetId: 7 }).catch((error: unknown) => error) })
    expect(classifyManualAssetWriteFailure(failure)).toBe('demo')
    expect(invalidate).not.toHaveBeenCalled()
    expect(mockBlockAccess).not.toHaveBeenCalled()
    await update.unmount(); await remove.unmount(); client.clear()
  })

  it('classifies failures, a 404 being an asset that is gone or private to the other member', () => {
    expect(classifyManualAssetWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyManualAssetWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyManualAssetWriteFailure(new ApiError('http', 403))).toBe('access')
    expect(classifyManualAssetWriteFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyManualAssetWriteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyManualAssetWriteFailure(new Error('boom'))).toBe('general')
  })
})

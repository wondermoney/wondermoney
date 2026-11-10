import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { assetFixture } from './test-fixtures'
import { classifyManualAssetWriteFailure, useCreateManualAsset, useRecordValuation } from './use-manual-asset-writes'

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

  it('classifies failures, a 404 being an asset that is gone or private to the other member', () => {
    expect(classifyManualAssetWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyManualAssetWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyManualAssetWriteFailure(new ApiError('http', 403))).toBe('access')
    expect(classifyManualAssetWriteFailure(new ApiError('http', 400))).toBe('invalid')
    expect(classifyManualAssetWriteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyManualAssetWriteFailure(new Error('boom'))).toBe('general')
  })
})

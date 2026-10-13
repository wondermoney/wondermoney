import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { categoriesKey } from './use-categories'
import { categoryWriteDemoKey, categoryWriteUnknownKey, classifyCategoryWriteFailure, useCategoryWrite } from './use-category-write'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpoch = 4
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: mockEpoch, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const system = { categoryKey: 1, name: 'FOOD', textColor: '#111111', bgColor: '#AABBCC', icon: 'cooking-pot', isSystemCategory: true }
const user = { categoryKey: 2, name: 'Lunch', textColor: '#FFFFFF', bgColor: '#123456', icon: 'coffee', isSystemCategory: false }
const data = { categories: [{ ...system, childCategory: [user] }] }
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
  client.setQueryData(categoriesKey(mockEpoch), data)
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('guarded category writes', () => {
  beforeEach(() => { mockEpoch = 4; jest.clearAllMocks() })

  it('single-flights a frozen exact POST and invalidates only authoritative Categories on commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let resolve!: (value: unknown) => void
    mockWrite.mockImplementation((endpoint, options) => new Promise((done) => {
      expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/category' })
      expect(options.body).toEqual({ name: 'Travel', color: '#123ABC', icon: 'plane', parentCategoryKey: '1' })
      expect(Object.isFrozen(options.body)).toBe(true)
      options.commit({ category: { categoryKey: 8, name: 'Travel', icon: 'plane', bgColor: '#123ABC' } })
      resolve = done
    }))
    const hook = await renderHook(() => useCategoryWrite(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync({ type: 'create', payload: { name: ' Travel ', color: '#123ABC', icon: 'plane', parentCategoryKey: '1' } }) })
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'create', payload: { name: 'Other', color: '#FFFFFF', icon: 'folder' } })).rejects.toThrow('already pending') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: categoriesKey(4), exact: true })
    await act(async () => { resolve({ category: { categoryKey: 8 } }); await first })
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await hook.unmount(); client.clear()
  })

  it('blocks system edits, child reparenting, and all remounted writes after an unknown outcome', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCategoryWrite(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'edit', categoryId: 1, payload: { name: 'No' } })).rejects.toThrow('Only visible user') })
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'create', payload: { name: 'Child', color: '#123ABC', icon: 'folder', parentCategoryKey: '2' } })).rejects.toThrow('visible root') })
    mockWrite.mockRejectedValue(new ApiError('network'))
    await act(async () => { await expect(hook.result.current.mutateAsync({ type: 'edit', categoryId: 2, payload: { name: 'Dinner' } })).rejects.toMatchObject({ code: 'network' }) })
    await waitFor(() => expect(hook.result.current.unknownGate).toEqual({ type: 'edit', categoryId: 2, payload: { name: 'Dinner' } }))
    await hook.unmount()
    const remount = await renderHook(() => useCategoryWrite(), { wrapper })
    await act(async () => { await expect(remount.result.current.mutateAsync({ type: 'edit', categoryId: 2, payload: { name: 'Dinner' } })).rejects.toThrow('blocked after an unknown') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await remount.unmount(); client.clear()
  })

  it('purges unknown payloads between auth epochs and classifies safety gates', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(categoryWriteUnknownKey(4), { type: 'create', payload: { name: 'Private', color: '#123ABC', icon: 'folder' } })
    mockEpoch = 5
    client.setQueryData(categoriesKey(5), data)
    const hook = await renderHook(() => useCategoryWrite(), { wrapper })
    await waitFor(() => expect(client.getQueryData(categoryWriteUnknownKey(4))).toBeUndefined())
    expect(hook.result.current.unknownGate).toBeNull()
    expect(classifyCategoryWriteFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyCategoryWriteFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
    expect(classifyCategoryWriteFailure(new ApiError('invalid-response'))).toBe('unknown')
    expect(classifyCategoryWriteFailure(new ApiError('http', 503))).toBe('unknown')
    expect(classifyCategoryWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyCategoryWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyCategoryWriteFailure(new ApiError('mfa-required'))).toBe('mfa')
    await hook.unmount(); client.clear()
  })

  it('persists demo read-only for the auth epoch and blocks remounted writes without dispatch', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('demo-forbidden'))
    const first = await renderHook(() => useCategoryWrite(), { wrapper })
    await act(async () => { await expect(first.result.current.mutateAsync({ type: 'create', payload: { name: 'Travel', color: '#123ABC', icon: 'folder' } })).rejects.toMatchObject({ code: 'demo-forbidden' }) })
    await waitFor(() => expect(first.result.current.demoLocked).toBe(true))
    expect(client.getQueryData(categoryWriteDemoKey(4))).toBe(true)
    await first.unmount()
    const remount = await renderHook(() => useCategoryWrite(), { wrapper })
    expect(remount.result.current.demoLocked).toBe(true)
    await act(async () => { await expect(remount.result.current.mutateAsync({ type: 'create', payload: { name: 'Again', color: '#ABCDEF', icon: 'folder' } })).rejects.toThrow('demo session') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await remount.unmount(); client.clear()
  })
})

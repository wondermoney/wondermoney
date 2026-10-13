import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { recurringItemFixture } from './test-fixtures'
import { useRecurringMutations } from './use-recurring-mutations'

const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 14, apiClient: { write: mockWrite } } }) }))

describe('useRecurringMutations', () => {
  beforeEach(() => mockWrite.mockReset())
  const setup = async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useRecurringMutations(), { wrapper })
    return { client, hook }
  }
  it.each([
    ['confirm', '/v1/recurring/7/confirm'],
    ['dismiss', '/v1/recurring/7/dismiss'],
  ] as const)('writes %s once and invalidates items and summary only from commit', async (kind, path) => {
    const { client, hook } = await setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let commit!: () => void
    mockWrite.mockImplementation(async (_endpoint, options) => { commit = options.commit; return undefined })
    await act(async () => { await hook.result.current.mutateAsync({ kind, id: 7 }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path }), expect.objectContaining({ commit: expect.any(Function) }))
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { commit(); await Promise.resolve() })
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring', 14, 'items'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring', 14, 'summary'] })
    await hook.unmount()
    client.clear()
  })
  it('commits the validated returned DTO without speculative values, then invalidates both resources', async () => {
    const { client, hook } = await setup()
    client.setQueryData(['recurring', 14, 'items'], { items: [recurringItemFixture] })
    const returned = { ...recurringItemFixture, displayName: 'Server name' }
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ recurringSeries: returned }); return { recurringSeries: returned } })
    await act(async () => { await hook.result.current.mutateAsync({ kind: 'update', id: 7, metadata: { displayName: 'Client name', categoryKey: null } }) })
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH', path: '/v1/recurring/7' }), expect.objectContaining({ body: { displayName: 'Client name', categoryKey: null } }))
    expect(client.getQueryData<{ items: typeof recurringItemFixture[] }>(['recurring', 14, 'items'])?.items[0]?.displayName).toBe('Server name')
    await hook.unmount()
    client.clear()
  })
  it('restores a dismissed series via the update endpoint with status candidate, then applies the returned DTO', async () => {
    const { client, hook } = await setup()
    client.setQueryData(['recurring', 14, 'items'], { items: [{ ...recurringItemFixture, status: 'dismissed' }] })
    const returned = { ...recurringItemFixture, status: 'candidate' as const }
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit({ recurringSeries: returned }); return { recurringSeries: returned } })
    await act(async () => { await hook.result.current.mutateAsync({ kind: 'restore', id: 7 }) })
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH', path: '/v1/recurring/7' }), expect.objectContaining({ body: { status: 'candidate' } }))
    expect(client.getQueryData<{ items: typeof recurringItemFixture[] }>(['recurring', 14, 'items'])?.items[0]?.status).toBe('candidate')
    await hook.unmount()
    client.clear()
  })
  it('rejects unsafe ids and invalid metadata before transport and has no retry', async () => {
    const { client, hook } = await setup()
    await act(async () => { await expect(hook.result.current.mutateAsync({ kind: 'confirm', id: -1 })).rejects.toThrow() })
    await act(async () => { await expect(hook.result.current.mutateAsync({ kind: 'update', id: 7, metadata: { expectedAmount: -2 } })).rejects.toThrow() })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })
  it('locks a row while its write is pending', async () => {
    const { client, hook } = await setup()
    let finish!: () => void
    mockWrite.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const first = hook.result.current.mutateAsync({ kind: 'confirm', id: 7 })
    await expect(hook.result.current.mutateAsync({ kind: 'dismiss', id: 7 })).rejects.toThrow('already pending')
    expect(mockWrite).toHaveBeenCalledTimes(1)
    finish()
    await first
    await hook.unmount()
    client.clear()
  })
  it('sends one no-body detection write, invalidates once per resource, and locks every recurring write', async () => {
    const { client, hook } = await setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    let finish!: (value: { created: number; updated: number; skipped: number }) => void
    let commit!: (value: { created: number; updated: number; skipped: number }) => void
    mockWrite.mockImplementation((_endpoint, options) => { commit = options.commit; return new Promise((resolve) => { finish = resolve }) })
    const first = hook.result.current.mutateAsync({ kind: 'detect' })
    await expect(hook.result.current.mutateAsync({ kind: 'detect' })).rejects.toThrow('already pending')
    await expect(hook.result.current.mutateAsync({ kind: 'confirm', id: 8 })).rejects.toThrow('already pending')
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/v1/recurring/detect' }), { commit: expect.any(Function) })
    const counts = { created: 2, updated: 1, skipped: 4 }
    await act(async () => { commit(counts); finish(counts); await first })
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenNthCalledWith(1, { queryKey: ['recurring', 14, 'items'] })
    expect(invalidate).toHaveBeenNthCalledWith(2, { queryKey: ['recurring', 14, 'summary'] })
    await hook.unmount()
    client.clear()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { classifyOfflineAccountCreateFailure, isFirstAccountCreation, useCreateOfflineAccount } from './use-create-offline-account'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))
jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 }, queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}
const payload = { name: 'Cash', currentBalance: 25.5, currencyId: 151, financialInstitutionId: 8 }

describe('manual account creation safety', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset(); captured.mockClear() })

  describe('first_account_created (RAD-518)', () => {
    const succeed = () => mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })

    it('reports the account that took an onboarding user from zero to one, with the method alone', async () => {
      const { client, wrapper } = setup()
      succeed()
      const hook = await renderHook(() => useCreateOfflineAccount('onboarding'), { wrapper })

      await act(async () => { await hook.result.current.mutateAsync(payload) })

      expect(captured.mock.calls).toEqual([['first_account_created', { method: 'manual' }]])
      // Nothing about the account itself: no name, balance, currency or institution.
      expect(JSON.stringify(captured.mock.calls)).not.toContain('Cash')
      expect(JSON.stringify(captured.mock.calls)).not.toContain('25.5')
      await hook.unmount(); client.clear()
    })

    it('reports an accounts-tab creation only when the list was read back as empty', async () => {
      const { client, wrapper } = setup()
      client.setQueryData(['accounts', 8], { accounts: [] })
      succeed()
      const hook = await renderHook(() => useCreateOfflineAccount(), { wrapper })

      await act(async () => { await hook.result.current.mutateAsync(payload) })

      expect(captured.mock.calls).toEqual([['first_account_created', { method: 'manual' }]])
      await hook.unmount(); client.clear()
    })

    it('stays silent for a second account and for an unknown list, rather than guessing', async () => {
      const { client, wrapper } = setup()
      client.setQueryData(['accounts', 8], { accounts: [{ id: 1 }] })
      succeed()
      const hook = await renderHook(() => useCreateOfflineAccount(), { wrapper })
      await act(async () => { await hook.result.current.mutateAsync(payload) })
      expect(captured).not.toHaveBeenCalled()

      const unknown = setup()
      const blind = await renderHook(() => useCreateOfflineAccount(), { wrapper: unknown.wrapper })
      await act(async () => { await blind.result.current.mutateAsync(payload) })
      expect(captured).not.toHaveBeenCalled()

      await hook.unmount(); await blind.unmount(); client.clear(); unknown.client.clear()
    })

    it('captures nothing when the create fails', async () => {
      const { client, wrapper } = setup()
      mockWrite.mockRejectedValue(new ApiError('http', 422))
      const hook = await renderHook(() => useCreateOfflineAccount('onboarding'), { wrapper })

      await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toBeInstanceOf(ApiError) })

      expect(captured).not.toHaveBeenCalled()
      await hook.unmount(); client.clear()
    })

    it('treats an absent list as unknown, not as zero', () => {
      expect(isFirstAccountCreation('accounts', undefined)).toBe(false)
      expect(isFirstAccountCreation('accounts', { accounts: [] })).toBe(true)
      expect(isFirstAccountCreation('onboarding', undefined)).toBe(true)
    })
  })

  it('freezes the exact body, runs once, and awaits current-epoch reconciliation before success', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    mockWrite.mockImplementation(async (endpoint, options) => {
      expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/account/offline', successStatuses: [201] })
      expect(Object.isFrozen(options.body)).toBe(true)
      options.commit(undefined)
      return undefined
    })
    const hook = await renderHook(() => useCreateOfflineAccount(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(payload) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][1].body).toEqual(payload)
    expect(mockWrite.mock.calls[0][1].body).not.toHaveProperty('accountType')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 8], exact: true, refetchType: 'all' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 8] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account-insights', 8] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8], exact: true })
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await hook.unmount(); client.clear()
  })

  it('rejects a double tap and never retries or infers a created id', async () => {
    const { client, wrapper } = setup()
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useCreateOfflineAccount(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync(payload) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    await act(async () => { await expect(hook.result.current.mutateAsync({ ...payload, name: 'Other' })).rejects.toThrow(/already pending/i) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(); await first })
    await hook.unmount(); client.clear()
  })

  it.each([
    new ApiError('network'), new ApiError('invalid-response'), new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }), new ApiError('http', 500),
  ])('gates an unknown outcome, preserves reviewed values, and requires explicit clearing (%s)', async (error) => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(error)
    const hook = await renderHook(() => useCreateOfflineAccount(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toBe(error) })
    await waitFor(() => expect(hook.result.current.unknownGuard?.payload).toEqual(payload))
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toMatchObject({ code: 'network' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await act(() => hook.result.current.clearUnknownGuard())
    await waitFor(() => expect(hook.result.current.unknownGuard).toBeNull())
    await hook.unmount(); client.clear()
  })

  it('treats pre-dispatch cancellation as definitive and does not establish the unknown gate', async () => {
    const { client, wrapper } = setup()
    const cancellation = new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' })
    mockWrite.mockRejectedValueOnce(cancellation).mockRejectedValueOnce(new ApiError('demo-forbidden', 403))
    const hook = await renderHook(() => useCreateOfflineAccount(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toBe(cancellation) })
    expect(hook.result.current.unknownGuard).toBeNull()
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toMatchObject({ code: 'demo-forbidden' }) })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })

  it('classifies validation, demo, access, MFA, unknown, and general failures distinctly', () => {
    expect(classifyOfflineAccountCreateFailure(new ApiError('http', 422))).toBe('validation')
    expect(classifyOfflineAccountCreateFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyOfflineAccountCreateFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyOfflineAccountCreateFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyOfflineAccountCreateFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
    expect(classifyOfflineAccountCreateFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyOfflineAccountCreateFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyOfflineAccountCreateFailure(new ApiError('http', 418))).toBe('general')
  })
})

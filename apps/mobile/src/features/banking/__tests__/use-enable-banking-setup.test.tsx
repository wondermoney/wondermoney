import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { enableBankingCredentialKey } from '../query-keys'
import { useActivateEnableBankingCredential } from '../use-enable-banking-setup'

const mockWrite = jest.fn()
const mockRead = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 7, apiClient: { read: mockRead, write: mockWrite } } }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('useActivateEnableBankingCredential', () => {
  it('writes the active credential into the cache, so a failed re-read cannot leave the setup showing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const key = enableBankingCredentialKey(7)
    client.setQueryData(key, { status: 'pending', pending: { expiresAt: '2026-12-03T10:00:00.000Z' } })
    // Someone is reading the credential, so the invalidation re-reads it; that re-read fails.
    mockRead.mockRejectedValue(new Error('offline'))
    const unsubscribe = new QueryObserver(client, { queryKey: key, queryFn: () => mockRead(), staleTime: Infinity }).subscribe(() => undefined)
    const active = { applicationId: '6b1b3c2a-4e9d-4f2a-9c1b-1234567890ab', pending: null, status: 'active' }
    mockWrite.mockResolvedValue(active)

    const hook = await renderHook(() => useActivateEnableBankingCredential(), { wrapper: wrap(client) })
    await act(async () => { await hook.result.current.mutateAsync({ applicationId: active.applicationId, totpCode: '123456' }) })

    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/v1/user/enable-banking-credential/activate' }),
      expect.objectContaining({ body: { applicationId: active.applicationId }, totpCode: '123456' }),
    )
    expect(mockRead).toHaveBeenCalled()
    expect(client.getQueryData(key)).toEqual(active)
    unsubscribe()
    await hook.unmount(); client.clear()
  })
})

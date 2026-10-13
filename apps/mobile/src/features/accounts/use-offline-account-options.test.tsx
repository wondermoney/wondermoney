import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useOfflineAccountOptions } from './use-offline-account-options'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
let mockRuntime: { epochId: number; apiClient: { read: typeof mockRead } } | null = null

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: mockRuntime, blockAccess: mockBlockAccess }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('useOfflineAccountOptions', () => {
  beforeEach(() => {
    mockRead.mockReset()
    mockBlockAccess.mockReset()
    mockRuntime = null
  })

  it('does not throw and reports loading while the authenticated runtime is not yet available', async () => {
    const client = new QueryClient()
    const hook = await renderHook(() => useOfflineAccountOptions(), { wrapper: wrap(client) })
    expect(hook.result.current.isLoading).toBe(true)
    expect(hook.result.current.currencies.data).toBeUndefined()
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('fetches currencies and institutions once the runtime becomes available', async () => {
    const client = new QueryClient()
    mockRead.mockImplementation((endpoint: { path: string }) => (
      endpoint.path === '/v1/account/currencies'
        ? Promise.resolve({ currencies: [{ currencyKey: 69, code: 'USD', description: 'United States dollar' }] })
        : Promise.resolve({ accountFinancialInstitutions: [] })
    ))
    const hook = await renderHook(() => useOfflineAccountOptions(), { wrapper: wrap(client) })
    expect(hook.result.current.isLoading).toBe(true)

    mockRuntime = { epochId: 3, apiClient: { read: mockRead } }
    hook.rerender({})

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.currencies.data?.currencies).toHaveLength(1)
    expect(mockRead).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })
})

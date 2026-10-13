import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useNetWorth } from './use-net-worth'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: 7, apiClient: { read: mockRead } },
    blockAccess: mockBlockAccess,
  }),
}))

describe('useNetWorth', () => {
  beforeEach(() => {
    mockRead.mockReset()
    mockBlockAccess.mockReset()
  })

  it('uses the epoch-isolated endpoint with retry disabled', async () => {
    const value = { currencyCode: 'EUR', totalNetWorth: 1, assets: { accounts: 1, portfolios: 0 }, liabilities: { loans: 0 }, rows: [], unsupportedCurrencies: { loans: 0, portfolios: 0 } }
    mockRead.mockResolvedValue(value)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useNetWorth(), { wrapper })

    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['net-worth', 7])).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it.each([
    ['mfa-required', 'mfa-required'],
  ] as const)('suppresses prior data synchronously for %s', async (code, transition) => {
    const value = { currencyCode: 'EUR', totalNetWorth: 1, assets: { accounts: 1, portfolios: 0 }, liabilities: { loans: 0 }, rows: [], unsupportedCurrencies: { loans: 0, portfolios: 0 } }
    mockRead
      .mockResolvedValueOnce(value)
      .mockRejectedValueOnce(new ApiError(code))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = await renderHook(() => useNetWorth(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))

    await hook.result.current.refetch()
    await waitFor(() => expect(hook.result.current.isAccessTransition).toBe(true))

    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.isInitialFailure).toBe(true)
    expect(hook.result.current.isRefreshFailure).toBe(false)
    expect(mockBlockAccess).toHaveBeenCalledWith(transition)
    await hook.unmount()
    client.clear()
  })
})

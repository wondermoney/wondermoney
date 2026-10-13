import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useHistoricalPrice } from './use-historical-price'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 7, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const response = { prices: [{ adjClose: null, close: 232.5, date: '2026-08-10', high: 235, low: 230, open: 231, volume: 1_000_000 }], source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' }, symbol: 'AAPL' }

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useHistoricalPrice', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('loads through the exact endpoint for the given period, keyed independently per period', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(({ period }: { period: '1M' | '3M' }) => useHistoricalPrice('AAPL', period), { wrapper, initialProps: { period: '1M' } })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead).toHaveBeenCalledTimes(1)
    await hook.rerender({ period: '3M' })
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    expect(client.getQueryData(['markets', 7, 'historical-price', 'AAPL', '1M'])).toEqual(response)
    expect(client.getQueryData(['markets', 7, 'historical-price', 'AAPL', '3M'])).toEqual(response)
    await hook.unmount(); client.clear()
  })

  it('never dispatches a request for an invalid symbol', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHistoricalPrice(null, '1M'), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('suppresses data and blocks access on an mfa-required error', async () => {
    mockRead.mockRejectedValue(new ApiError('mfa-required'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHistoricalPrice('AAPL', '1M'), { wrapper })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount(); client.clear()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useCompanyInfo } from './use-company-info'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 7, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const response = { companyInformation: { beta: null, ceo: null, changePercentage: null, country: 'US', currency: 'USD', description: null, employees: null, exchange: 'NASDAQ', image: null, industry: null, name: 'Apple Inc.', price: null, sector: null, symbol: 'AAPL', website: null } }

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useCompanyInfo', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('loads through the exact endpoint and isolated key', async () => {
    mockRead.mockResolvedValue(response)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCompanyInfo('AAPL'), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(response))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/financial-markets/ticker/AAPL/info' }))
    expect(client.getQueryData(['markets', 7, 'company-info', 'AAPL'])).toEqual(response)
    await hook.unmount(); client.clear()
  })

  it('never dispatches a request for an invalid symbol', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCompanyInfo(null), { wrapper })
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('suppresses data and blocks access on an MFA error', async () => {
    mockRead.mockRejectedValue(new ApiError('mfa-required'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useCompanyInfo('AAPL'), { wrapper })
    await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    expect(hook.result.current.data).toBeUndefined()
    await hook.unmount(); client.clear()
  })
})

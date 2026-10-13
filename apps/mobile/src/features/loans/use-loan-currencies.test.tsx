import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useLoanCurrencies } from './use-loan-currencies'

const mockRead = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 7, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess }),
}))

const value = { currencies: [{ currencyKey: 1, code: 'EUR', description: 'Euro' }] }
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('useLoanCurrencies', () => {
  beforeEach(() => { mockRead.mockReset(); mockBlockAccess.mockReset() })

  it('reuses the accounts feature global currency endpoint and query key', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useLoanCurrencies(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/account/currencies' }))
    expect(client.getQueryData(['account-create', 7, 'currencies'])).toEqual(value)
    await hook.unmount(); client.clear()
  })

  it('transitions access on MFA rejection', async () => {
    mockRead.mockRejectedValue(new ApiError('mfa-required'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useLoanCurrencies(), { wrapper })
    await waitFor(() => expect(hook.result.current.isAccessTransition).toBe(true))
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})

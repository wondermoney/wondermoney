import { renderHook } from '@testing-library/react-native'

import { useReportsCurrency } from './use-reports-currency'

const mockUseAccounts = jest.fn()
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))

describe('useReportsCurrency', () => {
  beforeEach(() => mockUseAccounts.mockReset())

  it('defaults to EUR when there are no accounts yet', async () => {
    mockUseAccounts.mockReturnValue({ data: { accounts: [] } })
    const hook = await renderHook(() => useReportsCurrency())
    expect(hook.result.current).toBe('EUR')
  })

  it('defaults to EUR while accounts are still loading', async () => {
    mockUseAccounts.mockReturnValue({ data: undefined })
    const hook = await renderHook(() => useReportsCurrency())
    expect(hook.result.current).toBe('EUR')
  })

  it('uses the first account owner currency', async () => {
    mockUseAccounts.mockReturnValue({
      data: { accounts: [{ accountOwnerAppuserKey: { currencyKey: { code: 'USD' } }, currencyKey: { code: 'GBP' } }] },
    })
    const hook = await renderHook(() => useReportsCurrency())
    expect(hook.result.current).toBe('USD')
  })
})

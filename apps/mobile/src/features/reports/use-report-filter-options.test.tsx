import { renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { useReportFilterOptions } from './use-report-filter-options'

const mockUseAccounts = jest.fn()
const mockUseCategories = jest.fn()
const mockUseReportMerchants = jest.fn()
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('@/features/categories/use-categories', () => ({ useCategories: () => mockUseCategories() }))
jest.mock('./use-report-merchants', () => ({ useReportMerchants: () => mockUseReportMerchants() }))

const account = (accountKey: number, accountName: string | null, currency: string) => ({
  accountKey, accountName, accountOwnerAppuserKey: { currencyKey: { code: currency } }, currencyKey: { code: currency },
})

async function renderWithI18n() {
  const i18n = await initMobileI18n('en')
  return renderHook(() => useReportFilterOptions(), { wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider> })
}

describe('useReportFilterOptions', () => {
  beforeEach(() => {
    mockUseAccounts.mockReturnValue({ data: { accounts: [account(1, 'Checking', 'EUR'), account(2, null, 'USD')] } })
    mockUseCategories.mockReturnValue({ data: { categories: [{ categoryKey: 1, name: 'Groceries', textColor: '#000', bgColor: '#fff', icon: null, isSystemCategory: false, childCategory: [] }] } })
    mockUseReportMerchants.mockReturnValue({ data: { transactionMerchants: [{ transactionMerchantKey: 5, name: 'Amazon' }] } })
  })

  it('bundles accounts, categories, merchants, and derived currencies from their independent sources', async () => {
    const hook = await renderWithI18n()
    expect(hook.result.current.accounts).toEqual([{ id: '1', label: 'Checking' }, { id: '2', label: 'Unknown account' }])
    expect(hook.result.current.categories).toEqual([{ id: '1', label: 'Groceries' }])
    expect(hook.result.current.merchants).toEqual([{ id: '5', label: 'Amazon' }])
    expect(hook.result.current.currencies).toEqual(['EUR', 'USD'])
  })

  it('renders empty option lists rather than throwing while any source is still loading', async () => {
    mockUseAccounts.mockReturnValue({ data: undefined })
    mockUseCategories.mockReturnValue({ data: undefined })
    mockUseReportMerchants.mockReturnValue({ data: undefined })
    const hook = await renderWithI18n()
    expect(hook.result.current).toEqual({ accounts: [], categories: [], merchants: [], currencies: [] })
  })
})

import { initMobileI18n } from '@/lib/i18n'

import { deriveAvailableCurrencies, mapAccountFilterOptions, mapCategoryFilterOptions, mapMerchantFilterOptions } from './report-filter-options'

const account = (accountKey: number, accountName: string | null, currency: string) => ({
  accountFinancialInstitutionKey: null,
  accountKey,
  accountName,
  accountOwnerAppuserKey: { currencyKey: { code: currency } },
  appuserCurrencyBalance: null,
  balance: null,
  currencyKey: { code: currency },
  isOwnedByViewer: true,
  isPrivate: false,
  refreshedAt: null,
  source: 'manual' as const,
})

describe('report filter options', () => {
  it('maps accounts to id/label options, falling back to an unknown-name label', () => {
    const options = mapAccountFilterOptions([account(1, 'Checking', 'EUR'), account(2, null, 'EUR')], 'Unknown')
    expect(options).toEqual([{ id: '1', label: 'Checking' }, { id: '2', label: 'Unknown' }])
  })

  it('flattens parent and child categories into one list with translated system names', async () => {
    const i18n = await initMobileI18n('en')
    const response = {
      categories: [
        { categoryKey: 1, name: 'Food & drink', textColor: '#000', bgColor: '#fff', icon: null, isSystemCategory: true, childCategory: [
          { categoryKey: 2, name: 'Groceries', textColor: '#000', bgColor: '#fff', icon: null, isSystemCategory: true, childCategory: [] },
        ] },
        { categoryKey: 3, name: 'My custom category', textColor: '#000', bgColor: '#fff', icon: null, isSystemCategory: false, childCategory: [] },
      ],
    }
    const options = mapCategoryFilterOptions(response, i18n.t)
    expect(options.map((o) => o.id)).toEqual(['1', '2', '3'])
    expect(options.find((o) => o.id === '3')?.label).toBe('My custom category')
  })

  it('maps merchants to id/label options', () => {
    const options = mapMerchantFilterOptions([{ transactionMerchantKey: 5, name: 'Amazon' }])
    expect(options).toEqual([{ id: '5', label: 'Amazon' }])
  })

  it('derives a deduplicated, sorted list of currencies actually present across accounts', () => {
    const currencies = deriveAvailableCurrencies([account(1, 'A', 'USD'), account(2, 'B', 'EUR'), account(3, 'C', 'USD')])
    expect(currencies).toEqual(['EUR', 'USD'])
  })
})

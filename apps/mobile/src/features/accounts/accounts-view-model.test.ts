import type { AccountSummaryDto } from './accounts-contract'
import { mapAccountSummary, mapAccounts } from './accounts-view-model'

const dto = (converted: number | null): AccountSummaryDto => ({
  accountFinancialInstitutionKey: { displayName: null, logoUrl: null },
  accountKey: 41,
  accountName: null,
  accountOwnerAppuserKey: { currencyKey: { code: 'GBP' } },
  appuserCurrencyBalance: converted,
  balance: -12.5,
  currencyKey: { code: 'USD' },
  isOwnedByViewer: true,
  isPrivate: false,
  refreshedAt: '2026-07-17T12:00:00.000Z',
  source: 'manual',
})

describe('accounts view model', () => {
  it('preserves exact values and nulls without exposing a logo', () => {
    const result = mapAccountSummary(dto(0))
    expect(result).toEqual({
      accountId: 41,
      accountName: null,
      institutionDisplayName: null,
      isOwnedByViewer: true,
      isPrivate: false,
      originalBalance: -12.5,
      convertedBalance: 0,
      originalCurrencyCode: 'USD',
      primaryCurrencyCode: 'GBP',
      refreshedAt: '2026-07-17T12:00:00.000Z',
      source: 'manual',
      csvImportFormat: null,
    })
    expect('logoUrl' in result).toBe(false)
  })

  it('preserves a null conversion without arithmetic or defaulting', () => {
    const result = mapAccountSummary(dto(null))
    expect(result.convertedBalance).toBeNull()
    expect(result.originalBalance).toBe(-12.5)
    expect(result).not.toHaveProperty('completeness')
  })

  it('preserves response order', () => {
    const rows = mapAccounts({ accounts: [{ ...dto(1), accountKey: 9 }, { ...dto(2), accountKey: 3 }] })
    expect(rows.map((row) => row.accountId)).toEqual([9, 3])
  })
})

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
  it('preserves exact values and nulls, carrying the institution logo only as the mark', () => {
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
      ownerFirstName: null,
      convertedAvailableBalance: null,
      syncStaleness: null,
      lastSyncedAt: null,
      institutionLogoUrl: null,
      accountType: null,
      creditCard: null,
      fx: { status: 'exact' },
    })
    expect('logoUrl' in result).toBe(false)
  })

  it('preserves a null conversion without arithmetic or defaulting', () => {
    const result = mapAccountSummary(dto(null))
    expect(result.convertedBalance).toBeNull()
    expect(result.originalBalance).toBe(-12.5)
    expect(result).not.toHaveProperty('completeness')
  })

  it("carries the institution's logo and the account type for the row's mark", () => {
    const result = mapAccountSummary({ ...dto(1), accountFinancialInstitutionKey: { displayName: 'Bank', logoUrl: 'https://cdn.example/bank.png' }, accountType: 'CREDIT_CARD' })
    expect(result).toMatchObject({ institutionLogoUrl: 'https://cdn.example/bank.png', accountType: 'CREDIT_CARD' })
  })

  it('reads a balance with no exchange rate as not converted, keeping its own balance to show', () => {
    expect(mapAccountSummary({ ...dto(null), fxStatus: 'missing', fxRateDate: null }).fx).toEqual({ status: 'missing', amount: -12.5, currency: 'USD' })
  })

  it('reads a legacy balance with no status and no converted amount as not converted', () => {
    expect(mapAccountSummary(dto(null)).fx).toEqual({ status: 'missing', amount: -12.5, currency: 'USD' })
  })

  it('reads a balance converted at an old rate as estimated, with the rate date', () => {
    expect(mapAccountSummary({ ...dto(10), fxStatus: 'provisional', fxRateDate: '2026-01-15' }).fx).toEqual({ status: 'provisional', rateDate: '2026-01-15' })
  })

  it('reads an account in its owner currency as exact, whatever the status says', () => {
    expect(mapAccountSummary({ ...dto(null), currencyKey: { code: 'GBP' }, fxStatus: 'missing' }).fx).toEqual({ status: 'exact' })
  })

  it('preserves response order', () => {
    const rows = mapAccounts({ accounts: [{ ...dto(1), accountKey: 9 }, { ...dto(2), accountKey: 3 }] })
    expect(rows.map((row) => row.accountId)).toEqual([9, 3])
  })
})

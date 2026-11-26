import type { AccountSummaryDto } from './accounts-contract'
import { balanceAsOfDate, formatAccountFreshness, mapAccountDetail } from './account-detail-view-model'

const dto: AccountSummaryDto = {
  accountFinancialInstitutionKey: { displayName: 'Wonder Bank', logoUrl: null },
  accountKey: 42,
  accountName: null,
  accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
  appuserCurrencyBalance: 0,
  balance: 100,
  currencyKey: { code: 'USD' },
  isOwnedByViewer: true,
  isPrivate: false,
  refreshedAt: '2026-07-17T10:00:00.000Z',
  myAccess: 'owner',
  source: 'open_banking',
}

describe('account detail view model', () => {
  it('preserves server values and nulls, the remote logo only as the mark', () => {
    expect(mapAccountDetail(dto)).toEqual({
      accountId: 42,
      accountName: null,
      attribution: null,
      institutionDisplayName: 'Wonder Bank',
      isOwnedByViewer: true,
      isPrivate: false,
      originalBalance: 100,
      convertedBalance: 0,
      originalCurrencyCode: 'USD',
      primaryCurrencyCode: 'EUR',
      refreshedAt: '2026-07-17T10:00:00.000Z',
      balanceDerivedAt: null,
      source: 'open_banking',
      csvImportFormat: null,
      ownerFirstName: null,
      convertedAvailableBalance: null,
      syncStaleness: null,
      lastSyncedAt: null,
      institutionLogoUrl: null,
      accountType: null,
      creditCard: null,
      myAccess: 'owner',
      fx: { status: 'exact' },
    })
    expect(mapAccountDetail(dto)).not.toHaveProperty('logoUrl')
  })

  it('formats a valid server timestamp by locale without claiming real-time sync', () => {
    const formatted = formatAccountFreshness(dto.refreshedAt!, 'en')
    expect(formatted).toContain('2026')
    expect(formatAccountFreshness(null, 'en')).toBeNull()
  })
})

describe('balance as-of date', () => {
  it('gives the date the bank last confirmed a derived balance', () => {
    expect(balanceAsOfDate({ balanceDerivedAt: '2026-07-20T06:00:00.000Z', refreshedAt: '2026-07-17T10:00:00.000Z' }, 'en')).toMatch(/Jul 17, 2026/)
  })

  it('gives none while the balance is the bank\u2019s own, or with no valid date', () => {
    expect(balanceAsOfDate({ balanceDerivedAt: null, refreshedAt: '2026-07-17T10:00:00.000Z' }, 'en')).toBeNull()
    expect(balanceAsOfDate({ balanceDerivedAt: '2026-07-20T06:00:00.000Z', refreshedAt: null }, 'en')).toBeNull()
    expect(balanceAsOfDate({ balanceDerivedAt: '2026-07-20T06:00:00.000Z', refreshedAt: 'garbage' }, 'en')).toBeNull()
  })
})

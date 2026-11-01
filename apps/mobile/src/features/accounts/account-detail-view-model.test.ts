import type { AccountSummaryDto } from './accounts-contract'
import { formatAccountFreshness, mapAccountDetail } from './account-detail-view-model'

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
  source: 'open_banking',
}

describe('account detail view model', () => {
  it('preserves server values and nulls without exposing the remote logo', () => {
    expect(mapAccountDetail(dto)).toEqual({
      accountId: 42,
      accountName: null,
      institutionDisplayName: 'Wonder Bank',
      isOwnedByViewer: true,
      isPrivate: false,
      originalBalance: 100,
      convertedBalance: 0,
      originalCurrencyCode: 'USD',
      primaryCurrencyCode: 'EUR',
      refreshedAt: '2026-07-17T10:00:00.000Z',
      source: 'open_banking',
      csvImportFormat: null,
    })
    expect(mapAccountDetail(dto)).not.toHaveProperty('logoUrl')
  })

  it('formats a valid server timestamp by locale without claiming real-time sync', () => {
    const formatted = formatAccountFreshness(dto.refreshedAt!, 'en')
    expect(formatted).toContain('2026')
    expect(formatAccountFreshness(null, 'en')).toBeNull()
  })
})

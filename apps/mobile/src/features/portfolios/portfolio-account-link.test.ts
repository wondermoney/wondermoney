import {
  chooseLinkAccount,
  defaultBalanceMode,
  draftFromLink,
  linkAccountLabel,
  linkChanged,
  linkInputFromDraft,
  linkMatches,
  sortLinkableAccounts,
} from './portfolio-account-link'
import { classifyPortfolioLinkFailure } from './use-portfolio-account-link'
import { classifyPortfolioSettingsFailure } from './use-portfolio-settings'
import { ApiError } from '@/lib/api/errors'

const manual = { accountKey: 1, accountName: 'Broker', accountType: 'INVESTMENT', source: 'manual' }
const synced = { accountKey: 2, accountName: null, accountType: 'CHECKING', source: 'open_banking', accountFinancialInstitutionKey: { displayName: 'Banco X' } }
const link = { accountKey: 1, accountName: 'Broker', mode: 'includes_holdings' as const }

describe('portfolio account link', () => {
  it('preselects cash only for a bank-synced account and includes-holdings otherwise, as web does', () => {
    expect(defaultBalanceMode(synced)).toBe('cash_only')
    expect(defaultBalanceMode(manual)).toBe('includes_holdings')
    expect(defaultBalanceMode({ source: 'unknown' })).toBe('includes_holdings')
    expect(chooseLinkAccount([manual, synced], 2)).toEqual({ accountId: 2, mode: 'cash_only' })
    expect(chooseLinkAccount([manual, synced], null)).toEqual({ accountId: null, mode: 'includes_holdings' })
    expect(chooseLinkAccount([manual, synced], 99)).toEqual({ accountId: null, mode: 'includes_holdings' })
  })

  it('sends a link only when it changed, so an unseen link is never touched', () => {
    expect(linkChanged(null, draftFromLink(null))).toBe(false)
    expect(linkChanged(link, draftFromLink(link))).toBe(false)
    expect(linkChanged(link, { accountId: 1, mode: 'cash_only' })).toBe(true)
    expect(linkChanged(link, { accountId: null, mode: 'includes_holdings' })).toBe(true)
    expect(linkChanged(null, { accountId: 2, mode: 'cash_only' })).toBe(true)
    expect(linkInputFromDraft({ accountId: null, mode: 'cash_only' })).toBeNull()
    expect(linkInputFromDraft({ accountId: 2, mode: 'cash_only' })).toEqual({ accountId: 2, mode: 'cash_only' })
  })

  it('matches a stored link against what was sent', () => {
    expect(linkMatches(link, { accountId: 1, mode: 'includes_holdings' })).toBe(true)
    expect(linkMatches(link, { accountId: 1, mode: 'cash_only' })).toBe(false)
    expect(linkMatches(null, null)).toBe(true)
    expect(linkMatches(undefined, null)).toBe(true)
    expect(linkMatches(link, null)).toBe(false)
    expect(linkMatches(null, { accountId: 1, mode: 'includes_holdings' })).toBe(false)
  })

  it('leads with investment accounts and names an unnamed account after its bank', () => {
    expect(sortLinkableAccounts([synced, manual]).map((account) => account.accountKey)).toEqual([1, 2])
    expect(linkAccountLabel(synced)).toBe('Banco X')
    expect(linkAccountLabel({ accountKey: 3, accountName: null, source: 'manual' })).toBe('3')
  })

  it('reads a held link as the holder, by name, and an older API’s plain 403 as the same refusal', () => {
    expect(classifyPortfolioLinkFailure(new ApiError('portfolio-link-held', 403, { linkedBy: 'Ana' }))).toEqual({ failure: 'link-held', holder: 'Ana' })
    expect(classifyPortfolioLinkFailure(new ApiError('portfolio-link-held', 403))).toEqual({ failure: 'link-managed', holder: null })
    expect(classifyPortfolioLinkFailure(new ApiError('http', 403))).toEqual({ failure: 'link-managed', holder: null })
    expect(classifyPortfolioLinkFailure(new ApiError('demo-forbidden', 403))).toEqual({ failure: 'demo', holder: null })
    expect(classifyPortfolioLinkFailure(new ApiError('http', 404))).toEqual({ failure: 'not-found', holder: null })
    expect(classifyPortfolioLinkFailure(new ApiError('network'))).toEqual({ failure: 'unknown', holder: null })
    expect(classifyPortfolioLinkFailure(new ApiError('http', 400))).toEqual({ failure: 'request', holder: null })
    expect(classifyPortfolioLinkFailure(new Error('boom'))).toEqual({ failure: 'general', holder: null })
  })

  it('reads a settings save refused over the link as the link refusal, not lost access', () => {
    expect(classifyPortfolioSettingsFailure(new ApiError('portfolio-link-held', 403, { linkedBy: 'Ana' }), { accountLink: null })).toBe('link-held')
    expect(classifyPortfolioSettingsFailure(new ApiError('portfolio-link-held', 403), { accountLink: null })).toBe('link-managed')
    expect(classifyPortfolioSettingsFailure(new ApiError('http', 403), { accountLink: { accountId: 2, mode: 'cash_only' } })).toBe('link-managed')
    expect(classifyPortfolioSettingsFailure(new ApiError('http', 403), { name: 'Renamed' })).toBe('access')
    expect(classifyPortfolioSettingsFailure(new ApiError('demo-forbidden', 403), { accountLink: null })).toBe('demo')
  })
})

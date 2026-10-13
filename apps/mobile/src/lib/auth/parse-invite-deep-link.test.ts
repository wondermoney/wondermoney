import { parseInviteDeepLink } from './parse-invite-deep-link'

describe('parseInviteDeepLink', () => {
  it('returns none for a null/undefined url', () => {
    expect(parseInviteDeepLink(null)).toEqual({ type: 'none' })
    expect(parseInviteDeepLink(undefined)).toEqual({ type: 'none' })
  })

  it('returns none for an unparseable url', () => {
    expect(parseInviteDeepLink('not a url')).toEqual({ type: 'none' })
  })

  it('returns none for an unrelated deep link', () => {
    expect(parseInviteDeepLink('wondermoney://sign-in')).toEqual({ type: 'none' })
    expect(parseInviteDeepLink('wondermoney://reset-password?token=abc')).toEqual({ type: 'none' })
  })

  it('returns none for a join link with no token', () => {
    expect(parseInviteDeepLink('wondermoney://join')).toEqual({ type: 'none' })
    expect(parseInviteDeepLink('wondermoney://join?token=')).toEqual({ type: 'none' })
  })

  it('extracts the token from a valid join link', () => {
    expect(parseInviteDeepLink('wondermoney://join?token=abc123')).toEqual({ type: 'invite', token: 'abc123' })
  })

  it('trims whitespace from the token', () => {
    expect(parseInviteDeepLink('wondermoney://join?token=%20abc123%20')).toEqual({ type: 'invite', token: 'abc123' })
  })
})

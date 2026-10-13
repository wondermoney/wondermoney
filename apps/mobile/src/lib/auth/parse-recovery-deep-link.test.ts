import { parseRecoveryDeepLink } from './parse-recovery-deep-link'

describe('parseRecoveryDeepLink', () => {
  it('returns none for null/undefined/empty input', () => {
    expect(parseRecoveryDeepLink(null)).toEqual({ type: 'none' })
    expect(parseRecoveryDeepLink(undefined)).toEqual({ type: 'none' })
    expect(parseRecoveryDeepLink('')).toEqual({ type: 'none' })
  })

  it('returns none for a malformed URL', () => {
    expect(parseRecoveryDeepLink('not a url')).toEqual({ type: 'none' })
  })

  it('returns none for a different host on the trusted scheme', () => {
    expect(parseRecoveryDeepLink('wondermoney://sign-in?token=abc')).toEqual({ type: 'none' })
  })

  it('returns none when the host is right but the scheme is not the app scheme', () => {
    expect(parseRecoveryDeepLink('https://reset-password?token=abc')).toEqual({ type: 'none' })
    expect(parseRecoveryDeepLink('wondermoney-other://reset-password?token=abc')).toEqual({ type: 'none' })
  })

  it('parses a well-formed reset link from the query string', () => {
    expect(parseRecoveryDeepLink('wondermoney://reset-password?token=abc123')).toEqual({
      type: 'recovery',
      token: 'abc123',
    })
  })

  it('returns expired when the link carries an error', () => {
    expect(parseRecoveryDeepLink('wondermoney://reset-password?error=INVALID_TOKEN')).toEqual({ type: 'expired' })
  })

  it('prefers the expired signal over a token when both are present', () => {
    expect(parseRecoveryDeepLink('wondermoney://reset-password?error=INVALID_TOKEN&token=abc')).toEqual({ type: 'expired' })
  })

  it('returns none when the token is missing or blank', () => {
    expect(parseRecoveryDeepLink('wondermoney://reset-password')).toEqual({ type: 'none' })
    expect(parseRecoveryDeepLink('wondermoney://reset-password?token=')).toEqual({ type: 'none' })
  })
})

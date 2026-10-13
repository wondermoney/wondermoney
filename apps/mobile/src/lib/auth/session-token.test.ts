import { extractSessionTokenFromCookieHeader } from './session-token'

describe('extractSessionTokenFromCookieHeader', () => {
  it('returns null for an empty or missing header', () => {
    expect(extractSessionTokenFromCookieHeader(null)).toBeNull()
    expect(extractSessionTokenFromCookieHeader(undefined)).toBeNull()
    expect(extractSessionTokenFromCookieHeader('')).toBeNull()
  })

  it('reads the default session cookie value', () => {
    expect(extractSessionTokenFromCookieHeader('better-auth.session_token=abc.def')).toBe('abc.def')
  })

  it('reads a Secure-prefixed session cookie', () => {
    expect(extractSessionTokenFromCookieHeader('__Secure-better-auth.session_token=opaque')).toBe('opaque')
  })

  it('reads a custom-prefixed session cookie', () => {
    expect(extractSessionTokenFromCookieHeader('myapp.session_token=custom')).toBe('custom')
    expect(extractSessionTokenFromCookieHeader('prod.better-auth.session_token=production')).toBe('production')
  })

  it('ignores non-session cookies and picks the session one out of many', () => {
    expect(extractSessionTokenFromCookieHeader('better-auth.session_data=cache; better-auth.session_token=real; other=1')).toBe('real')
  })

  it('does not confuse session_data for session_token', () => {
    expect(extractSessionTokenFromCookieHeader('better-auth.session_data=cache')).toBeNull()
  })

  it('decodes a URL-encoded value', () => {
    expect(extractSessionTokenFromCookieHeader('better-auth.session_token=a%2Eb')).toBe('a.b')
  })

  it('returns null for an empty value', () => {
    expect(extractSessionTokenFromCookieHeader('better-auth.session_token=')).toBeNull()
  })
})

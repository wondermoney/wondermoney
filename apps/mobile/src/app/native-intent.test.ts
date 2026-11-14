import { redirectSystemPath } from './+native-intent'

describe('redirectSystemPath', () => {
  it('opens the connections list with the outcome when the bank return link starts the app', () => {
    expect(redirectSystemPath({ path: 'wondermoney://more/banking?enableBankingConnection=success', initial: true }))
      .toBe('/more/banking?justStarted=1&connection=success')
    expect(redirectSystemPath({ path: 'wondermoney://more/banking?enableBankingConnection=bogus', initial: true }))
      .toBe('/more/banking?justStarted=1')
  })

  it('leaves the bank return link to the auth session while the app is running, so it navigates once', () => {
    expect(redirectSystemPath({ path: 'wondermoney://more/banking?enableBankingConnection=success', initial: false })).toBeNull()
  })

  it('passes every other link through unchanged', () => {
    for (const initial of [true, false]) {
      expect(redirectSystemPath({ path: 'wondermoney://reset-password?token=abc', initial })).toBe('wondermoney://reset-password?token=abc')
      expect(redirectSystemPath({ path: 'wondermoney://more/banking', initial })).toBe('wondermoney://more/banking')
    }
  })

  it('opens sign-in with the pairing code, whether the app was running or not', () => {
    const link = 'wondermoney://pair?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop'
    const expected = '/sign-in?pairCode=abcdefghijklmnop&pairServer=https%3A%2F%2Fapi.example.test'

    expect(redirectSystemPath({ path: link, initial: true })).toBe(expected)
    expect(redirectSystemPath({ path: link, initial: false })).toBe(expected)
  })

  it('still lands on sign-in for a malformed pairing link', () => {
    expect(redirectSystemPath({ path: 'wondermoney://pair?code=short', initial: true })).toBe('/sign-in')
  })
})

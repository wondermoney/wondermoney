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
})

import {
  BANK_CONNECTION_RETURN_URL,
  bankConnectionsHref,
  isBankConnectionReturnUrl,
  parseBankConnectionResultParam,
  parseBankConnectionReturnUrl,
  readBankConnectionResult,
} from '../bank-connection-return'

const returnLink = (outcome: string) => `${BANK_CONNECTION_RETURN_URL}?enableBankingConnection=${outcome}`

describe('the bank connection return link', () => {
  it('is the app-scheme link the API callback redirects a mobile connection to', () => {
    expect(BANK_CONNECTION_RETURN_URL).toBe('wondermoney://more/banking')
    expect(isBankConnectionReturnUrl(returnLink('success'))).toBe(true)
  })

  it('reads the outcome', () => {
    expect(parseBankConnectionReturnUrl(returnLink('success'))).toBe('success')
    expect(parseBankConnectionReturnUrl(returnLink('error'))).toBe('error')
  })

  it('ignores an outcome it does not know, or none', () => {
    expect(parseBankConnectionReturnUrl(returnLink('maybe'))).toBeNull()
    expect(parseBankConnectionReturnUrl(BANK_CONNECTION_RETURN_URL)).toBeNull()
    expect(isBankConnectionReturnUrl(BANK_CONNECTION_RETURN_URL)).toBe(false)
  })

  it('ignores any other link that carries the param', () => {
    for (const url of [
      'https://more/banking?enableBankingConnection=success',
      'wondermoney://attacker/banking?enableBankingConnection=success',
      'wondermoney://more/other?enableBankingConnection=success',
      'wondermoney://reset-password?token=abc',
      'not a url',
    ]) {
      expect(isBankConnectionReturnUrl(url)).toBe(false)
      expect(parseBankConnectionReturnUrl(url)).toBeNull()
    }
  })
})

describe('readBankConnectionResult', () => {
  it('reads the outcome when the session saw the return link', () => {
    expect(readBankConnectionResult({ type: 'success', url: returnLink('error') })).toBe('error')
  })

  it('knows nothing when the user closed the session', () => {
    expect(readBankConnectionResult({ type: 'cancel' } as never)).toBeNull()
    expect(readBankConnectionResult({ type: 'dismiss' } as never)).toBeNull()
  })
})

describe('bankConnectionsHref', () => {
  it('opens the polling connections list, with the outcome when known', () => {
    expect(bankConnectionsHref('success')).toEqual({ pathname: '/more/banking', params: { justStarted: '1', connection: 'success' } })
    expect(bankConnectionsHref(null)).toEqual({ pathname: '/more/banking', params: { justStarted: '1' } })
  })
})

describe('parseBankConnectionResultParam', () => {
  it('accepts only success and error', () => {
    expect(parseBankConnectionResultParam('success')).toBe('success')
    expect(parseBankConnectionResultParam('error')).toBe('error')
    expect(parseBankConnectionResultParam('other')).toBeNull()
    expect(parseBankConnectionResultParam(['success'])).toBeNull()
    expect(parseBankConnectionResultParam(undefined)).toBeNull()
  })
})

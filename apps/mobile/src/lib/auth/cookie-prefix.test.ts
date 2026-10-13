import { getBetterAuthCookiePrefix } from './cookie-prefix'

describe('getBetterAuthCookiePrefix', () => {
  it('uses the production cookie prefix only for the production API', () => {
    expect(getBetterAuthCookiePrefix('https://api.wonder.money')).toBe('prod.better-auth')
    expect(getBetterAuthCookiePrefix('https://staging.api.wonder.money')).toBeUndefined()
    expect(getBetterAuthCookiePrefix('http://localhost:3001')).toBeUndefined()
  })
})

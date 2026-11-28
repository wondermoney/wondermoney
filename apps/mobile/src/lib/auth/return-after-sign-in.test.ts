import {
  clearReturnAfterSignIn,
  hasReturnAfterSignIn,
  requestReturnAfterSignIn,
  takeReturnAfterSignIn,
} from './return-after-sign-in'

const SERVER = 'https://api.example.test'
const request = { href: '/more/banking/connect' as const, principalId: 'user-1', server: SERVER }

describe('return after sign-in', () => {
  afterEach(() => { clearReturnAfterSignIn() })

  it('hands the screen back once to the same person on the same server; peeking leaves it in place', () => {
    expect(hasReturnAfterSignIn()).toBe(false)
    requestReturnAfterSignIn(request)
    expect(hasReturnAfterSignIn()).toBe(true)
    expect(hasReturnAfterSignIn()).toBe(true)
    expect(takeReturnAfterSignIn('user-1', SERVER)).toBe('/more/banking/connect')
    expect(takeReturnAfterSignIn('user-1', SERVER)).toBeNull()
    expect(hasReturnAfterSignIn()).toBe(false)
  })

  it('drops the request when someone else signs in', () => {
    requestReturnAfterSignIn(request)
    expect(takeReturnAfterSignIn('user-2', SERVER)).toBeNull()
    expect(hasReturnAfterSignIn()).toBe(false)
  })

  it('drops the request when the sign-in is to another server', () => {
    requestReturnAfterSignIn(request)
    expect(takeReturnAfterSignIn('user-1', 'https://other.example.test')).toBeNull()
    expect(hasReturnAfterSignIn()).toBe(false)
  })
})

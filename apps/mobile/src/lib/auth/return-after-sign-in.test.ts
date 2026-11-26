import { hasReturnAfterSignIn, requestReturnAfterSignIn, takeReturnAfterSignIn } from './return-after-sign-in'

describe('return after sign-in', () => {
  afterEach(() => { takeReturnAfterSignIn() })

  it('hands the screen back once, and peeking leaves it in place', () => {
    expect(hasReturnAfterSignIn()).toBe(false)
    requestReturnAfterSignIn('/more/banking/connect')
    expect(hasReturnAfterSignIn()).toBe(true)
    expect(hasReturnAfterSignIn()).toBe(true)
    expect(takeReturnAfterSignIn()).toBe('/more/banking/connect')
    expect(takeReturnAfterSignIn()).toBeNull()
    expect(hasReturnAfterSignIn()).toBe(false)
  })

  it('keeps the latest request', () => {
    requestReturnAfterSignIn('/more')
    requestReturnAfterSignIn('/more/banking/connect')
    expect(takeReturnAfterSignIn()).toBe('/more/banking/connect')
  })
})

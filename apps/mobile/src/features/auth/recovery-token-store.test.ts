import { setPendingRecoveryTokens, takePendingRecoveryTokens } from './recovery-token-store'

describe('recovery token store', () => {
  it('returns null when nothing is pending', () => {
    expect(takePendingRecoveryTokens()).toBeNull()
  })

  it('returns and clears the token on take (read-once)', () => {
    setPendingRecoveryTokens({ token: 'at' })
    expect(takePendingRecoveryTokens()).toEqual({ token: 'at' })
    expect(takePendingRecoveryTokens()).toBeNull()
  })
})

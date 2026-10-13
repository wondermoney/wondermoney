import { setPendingInviteToken, takePendingInviteToken } from './invite-token-store'

describe('invite token store', () => {
  it('returns null when nothing is pending', () => {
    expect(takePendingInviteToken()).toBeNull()
  })

  it('returns and clears the token on take (read-once)', () => {
    setPendingInviteToken('tok-1')
    expect(takePendingInviteToken()).toBe('tok-1')
    expect(takePendingInviteToken()).toBeNull()
  })
})

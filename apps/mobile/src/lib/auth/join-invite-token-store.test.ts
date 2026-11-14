import { setJoinInviteToken, takeJoinInviteToken } from './join-invite-token-store'
import { takePendingInviteToken } from './invite-token-store'

describe('join invite token store', () => {
  it('returns null when nothing is pending', () => {
    expect(takeJoinInviteToken()).toBeNull()
  })

  it('returns and clears the token on take (read-once)', () => {
    setJoinInviteToken('tok-1')
    expect(takeJoinInviteToken()).toBe('tok-1')
    expect(takeJoinInviteToken()).toBeNull()
  })

  it('never hands the token to the sign-up provisioning store', () => {
    setJoinInviteToken('tok-2')
    expect(takePendingInviteToken()).toBeNull()
    takeJoinInviteToken()
  })
})

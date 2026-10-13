import { profileEndpoint, profileResponseSchema } from './self-contracts'

const profile = {
  emailAddress: 'person@example.com',
  firstName: 'Ada',
  lastName: null,
  mfaEnabled: true,
}

describe('self read contracts', () => {
  it('pins the exact private read endpoints', () => {
    expect(profileEndpoint).toMatchObject({ method: 'GET', path: '/v1/user/me/profile' })
  })

  it('preserves explicit profile nulls and accepts harmless additive fields', () => {
    expect(profileResponseSchema.parse({
      profile: { ...profile, firstName: null, lastName: null, future: true },
      generatedAt: 'future',
    })).toEqual({ profile: { ...profile, firstName: null, lastName: null } })
  })

  it.each([
    ['missing profile', {}],
    ['invalid email', { profile: { ...profile, emailAddress: 'not-email' } }],
    ['long email', { profile: { ...profile, emailAddress: `${'a'.repeat(310)}@example.com` } }],
    ['missing first name', { profile: { ...profile, firstName: undefined } }],
    ['long first name', { profile: { ...profile, firstName: 'a'.repeat(256) } }],
    ['missing last name', { profile: { ...profile, lastName: undefined } }],
    ['nonboolean MFA', { profile: { ...profile, mfaEnabled: 'yes' } }],
  ])('rejects malformed profile: %s', (_label, candidate) => {
    expect(profileResponseSchema.safeParse(candidate).success).toBe(false)
  })
})

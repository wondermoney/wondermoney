import {
  createRemoveHouseholdMemberEndpoint,
  createResendHouseholdInviteEndpoint,
  createRevokeHouseholdInviteEndpoint,
  HOUSEHOLD_MAX_MEMBERS,
  householdEndpoint,
  householdMemberSchema,
  householdResponseSchema,
  inviteEmailSchema,
  inviteHouseholdMemberEndpoint,
  inviteMutationResponseSchema,
  isValidAppuserKey,
  isValidHouseholdInviteId,
  pendingHouseholdInviteSchema,
} from './household-contract'

const owner = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Owner', role: 'owner' as const }
const member = { appuserKey: 2, emailAddress: 'partner@example.com', firstName: null, role: 'member' as const }

describe('household read contract', () => {
  it('pins GET /v1/household', () => {
    expect(householdEndpoint.method).toBe('GET')
    expect(householdEndpoint.path).toBe('/v1/household')
    expect(householdEndpoint.schema).toBe(householdResponseSchema)
  })

  it('caps a household at owner + one partner', () => {
    expect(HOUSEHOLD_MAX_MEMBERS).toBe(2)
  })

  it('accepts owner and member roles', () => {
    expect(householdMemberSchema.parse(owner)).toEqual(owner)
    expect(householdMemberSchema.parse(member)).toEqual(member)
  })

  it('reads a role this build does not know as unknown (never the owner) and strips added fields', () => {
    expect(householdMemberSchema.parse({ ...owner, role: 'admin' }).role).toBe('unknown')
    expect(householdMemberSchema.parse({ ...owner, extra: true })).toEqual(owner)
    expect(householdMemberSchema.safeParse({ ...owner, role: undefined }).success).toBe(false)
  })

  it('allows firstName to be omitted or null', () => {
    const { firstName: _firstName, ...withoutFirstName } = owner
    expect(householdMemberSchema.safeParse(withoutFirstName).success).toBe(true)
    expect(householdMemberSchema.safeParse({ ...owner, firstName: null }).success).toBe(true)
  })

  it('accepts a household with a pending invite and one with none', () => {
    const withPending = {
      members: [owner],
      pendingInvite: { email: 'partner@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5 },
    }
    expect(householdResponseSchema.parse(withPending)).toEqual(withPending)
    expect(householdResponseSchema.parse({ members: [owner, member], pendingInvite: null }).pendingInvite).toBeNull()
  })

  it('rejects an invite missing a required field', () => {
    expect(pendingHouseholdInviteSchema.safeParse({ email: 'a@b.co', expiresAt: '2026-01-08T00:00:00.000Z' }).success).toBe(false)
  })
})

describe('household invite email validation', () => {
  it('mirrors the API validator: trims and lowercases', () => {
    expect(inviteEmailSchema.parse('  Partner@Example.com  ')).toBe('partner@example.com')
  })

  it('rejects an invalid email', () => {
    expect(inviteEmailSchema.safeParse('not-an-email').success).toBe(false)
  })
})

describe('household write endpoints', () => {
  it('pins POST /v1/household/invites', () => {
    expect(inviteHouseholdMemberEndpoint.method).toBe('POST')
    expect(inviteHouseholdMemberEndpoint.path).toBe('/v1/household/invites')
    expect(inviteHouseholdMemberEndpoint.successStatuses).toEqual([201])
  })

  it('parses the 201 invite response envelope', () => {
    const body = { invite: { email: 'partner@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5, status: 'pending' } }
    expect(inviteMutationResponseSchema.parse(body)).toEqual(body)
  })

  it('pins POST /v1/household/invites/:id/resend', () => {
    const endpoint = createResendHouseholdInviteEndpoint(5)
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/household/invites/5/resend')
    expect(endpoint.successStatuses).toEqual([200])
  })

  it('pins DELETE /v1/household/invites/:id with no body', () => {
    const endpoint = createRevokeHouseholdInviteEndpoint(5)
    expect(endpoint.method).toBe('DELETE')
    expect(endpoint.path).toBe('/v1/household/invites/5')
    expect(endpoint.successStatuses).toEqual([200])
  })

  it('pins DELETE /v1/household/members/:appuserKey with no body', () => {
    const endpoint = createRemoveHouseholdMemberEndpoint(2)
    expect(endpoint.method).toBe('DELETE')
    expect(endpoint.path).toBe('/v1/household/members/2')
    expect(endpoint.successStatuses).toEqual([200])
  })

  it.each([0, -1, 1.5])('rejects an unsafe household invite id %s', (id) => {
    expect(() => createResendHouseholdInviteEndpoint(id)).toThrow()
    expect(() => createRevokeHouseholdInviteEndpoint(id)).toThrow()
  })

  it.each([0, -1, 1.5])('rejects an unsafe appuser key %s', (id) => {
    expect(() => createRemoveHouseholdMemberEndpoint(id)).toThrow()
  })
})

describe('household id guards', () => {
  it('accepts only positive integers', () => {
    expect(isValidHouseholdInviteId(1)).toBe(true)
    expect(isValidHouseholdInviteId(0)).toBe(false)
    expect(isValidHouseholdInviteId(-1)).toBe(false)
    expect(isValidHouseholdInviteId(1.5)).toBe(false)
    expect(isValidAppuserKey(1)).toBe(true)
    expect(isValidAppuserKey(0)).toBe(false)
  })
})

import {
  createAcceptHouseholdInviteEndpoint,
  createRemoveHouseholdMemberEndpoint,
  createResendHouseholdInviteEndpoint,
  createRevokeHouseholdInviteEndpoint,
  createUpdateHouseholdMemberRoleEndpoint,
  grantableRoleSchema,
  LEGACY_HOUSEHOLD_MAX_MEMBERS,
  householdEndpoint,
  householdMemberSchema,
  householdResponseSchema,
  inviteEmailSchema,
  inviteHouseholdMemberEndpoint,
  inviteMutationResponseSchema,
  isValidAppuserKey,
  isValidHouseholdInviteId,
  pendingHouseholdInviteSchema,
  transferHouseholdOwnershipEndpoint,
} from './household-contract'

const owner = { appuserKey: 1, emailAddress: 'owner@example.com', firstName: 'Owner', role: 'owner' as const }
const member = { appuserKey: 2, emailAddress: 'partner@example.com', firstName: null, role: 'member' as const }

describe('household read contract', () => {
  it('pins GET /v1/household', () => {
    expect(householdEndpoint.method).toBe('GET')
    expect(householdEndpoint.path).toBe('/v1/household')
    expect(householdEndpoint.schema).toBe(householdResponseSchema)
  })

  it('accepts every household role', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(householdMemberSchema.parse({ ...owner, role }).role).toBe(role)
    }
    expect(householdMemberSchema.parse(member)).toEqual(member)
  })

  it('reads a role this build does not know as unknown (never the owner) and strips added fields', () => {
    expect(householdMemberSchema.parse({ ...owner, role: 'auditor' }).role).toBe('unknown')
    expect(householdMemberSchema.parse({ ...owner, extra: true })).toEqual(owner)
    expect(householdMemberSchema.safeParse({ ...owner, role: undefined }).success).toBe(false)
  })

  it('allows firstName to be omitted or null', () => {
    const { firstName: _firstName, ...withoutFirstName } = owner
    expect(householdMemberSchema.safeParse(withoutFirstName).success).toBe(true)
    expect(householdMemberSchema.safeParse({ ...owner, firstName: null }).success).toBe(true)
  })

  it('reads the current shape: every invite with its role, the cap and the viewer', () => {
    const invite = { email: 'b@x.test', expiresAt: '2026-11-20T10:00:00.000Z', householdInviteKey: 7, role: 'viewer' }
    const parsed = householdResponseSchema.parse({
      maxMembers: 6,
      members: [owner, { ...member, role: 'admin' }],
      pendingInvites: [invite, { ...invite, householdInviteKey: 8, role: 'member' }],
      pendingInvite: { email: invite.email, expiresAt: invite.expiresAt, householdInviteKey: 7 },
      viewerAppuserKey: 1,
    })
    expect(parsed.maxMembers).toBe(6)
    expect(parsed.viewerAppuserKey).toBe(1)
    expect(parsed.pendingInvites.map((entry) => [entry.householdInviteKey, entry.role])).toEqual([[7, 'viewer'], [8, 'member']])
    expect(parsed.members.map((entry) => entry.role)).toEqual(['owner', 'admin'])
  })

  it('still reads an older API: one pendingInvite, no cap, no viewer key, roles owner/member', () => {
    const old = {
      members: [owner],
      pendingInvite: { email: 'partner@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5 },
    }
    expect(householdResponseSchema.parse(old)).toEqual({
      members: [owner],
      maxMembers: LEGACY_HOUSEHOLD_MAX_MEMBERS,
      pendingInvites: [{ email: 'partner@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5, role: 'member' }],
      viewerAppuserKey: null,
    })
    expect(LEGACY_HOUSEHOLD_MAX_MEMBERS).toBe(2)
    expect(householdResponseSchema.parse({ members: [owner, member], pendingInvite: null }).pendingInvites).toEqual([])
    expect(householdResponseSchema.parse({ members: [owner, member] }).pendingInvites).toEqual([])
  })

  it('prefers pendingInvites over the deprecated pendingInvite when both are sent', () => {
    const invite = { email: 'b@x.test', expiresAt: '2026-11-20T10:00:00.000Z', householdInviteKey: 7 }
    const parsed = householdResponseSchema.parse({ members: [owner], pendingInvites: [], pendingInvite: invite })
    expect(parsed.pendingInvites).toEqual([])
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

  it('parses the 201 invite response envelope, with or without a role', () => {
    const body = { invite: { email: 'partner@example.com', expiresAt: '2026-01-08T00:00:00.000Z', householdInviteKey: 5, status: 'pending' } }
    expect(inviteMutationResponseSchema.parse(body)).toEqual(body)
    const withRole = { invite: { ...body.invite, role: 'viewer' } }
    expect(inviteMutationResponseSchema.parse(withRole)).toEqual(withRole)
  })

  it('grants only admin, member and viewer', () => {
    expect(grantableRoleSchema.options).toEqual(['admin', 'member', 'viewer'])
    expect(grantableRoleSchema.safeParse('owner').success).toBe(false)
  })

  it('pins PATCH /v1/household/members/:appuserKey', () => {
    const endpoint = createUpdateHouseholdMemberRoleEndpoint(4)
    expect(endpoint.method).toBe('PATCH')
    expect(endpoint.path).toBe('/v1/household/members/4')
    expect(endpoint.successStatuses).toEqual([200])
    expect(endpoint.schema.safeParse({ member: { ...member, role: 'viewer' } }).success).toBe(true)
  })

  it('pins POST /v1/household/transfer-ownership, answered with the household', () => {
    expect(transferHouseholdOwnershipEndpoint.method).toBe('POST')
    expect(transferHouseholdOwnershipEndpoint.path).toBe('/v1/household/transfer-ownership')
    expect(transferHouseholdOwnershipEndpoint.schema.parse({ members: [owner], maxMembers: 6, pendingInvites: [], viewerAppuserKey: 1 }).maxMembers).toBe(6)
  })

  it('pins POST /v1/household/invites/:token/accept with the token encoded', () => {
    const endpoint = createAcceptHouseholdInviteEndpoint(' a/b c ')
    expect(endpoint.method).toBe('POST')
    expect(endpoint.path).toBe('/v1/household/invites/a%2Fb%20c/accept')
    expect(() => createAcceptHouseholdInviteEndpoint('  ')).toThrow()
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
    expect(() => createUpdateHouseholdMemberRoleEndpoint(id)).toThrow()
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

import {
  accountSharesResponseSchema,
  accountSharesWriteSchema,
  buildAccountSharesWrite,
  createAccountSharesEndpoint,
  createUpdateAccountSharesEndpoint,
  initialShareChoices,
  shareChoicesFor,
  type AccountSharesDto,
} from './account-sharing-contract'

const owner = { appuserKey: 3, firstName: 'Ana', lastName: 'Silva', role: 'owner', isAccountOwner: true, share: null, access: 'owner' } as const
const rui = { appuserKey: 4, firstName: 'Rui', lastName: null, role: 'member', isAccountOwner: false, share: null, access: 'write' } as const
const eva = { appuserKey: 5, firstName: 'Eva', lastName: null, role: 'viewer', isAccountOwner: false, share: null, access: 'read' } as const
const joao = { appuserKey: 6, firstName: 'João', lastName: null, role: 'admin', isAccountOwner: false, share: null, access: 'write' } as const

const shared: AccountSharesDto = { accountKey: 12, isPrivate: false, canManage: true, members: [owner, rui, eva, joao] }

describe('account sharing contract', () => {
  it('pins the read and write endpoints and refuses an invalid account id', () => {
    expect(createAccountSharesEndpoint(12)).toMatchObject({ method: 'GET', path: '/v1/account/12/shares' })
    expect(createUpdateAccountSharesEndpoint(12)).toMatchObject({ method: 'PUT', path: '/v1/account/12/shares' })
    expect(() => createAccountSharesEndpoint(0)).toThrow(/account id/i)
    expect(() => createUpdateAccountSharesEndpoint(-1)).toThrow(/account id/i)
  })

  it('reads the GET body, an unknown role or access tolerantly, and refuses a malformed member', () => {
    const parsed = accountSharesResponseSchema.parse({
      ...shared,
      members: [owner, { ...rui, role: 'guardian', share: 'write', access: 'write' }, { ...eva, access: 'admin', future: true }],
    })
    expect(parsed.members.map((member) => [member.role, member.access])).toEqual([['owner', 'owner'], ['member', 'write'], ['viewer', 'hidden']])
    expect(accountSharesResponseSchema.safeParse({ ...shared, members: [{ ...rui, appuserKey: 'x' }] }).success).toBe(false)
    expect(accountSharesResponseSchema.safeParse({ ...shared, canManage: undefined }).success).toBe(false)
  })

  it('keeps the PUT body strict', () => {
    expect(accountSharesWriteSchema.safeParse({ isPrivate: true, shares: [{ appuserKey: 4, access: 'read' }] }).success).toBe(true)
    expect(accountSharesWriteSchema.safeParse({ isPrivate: true, shares: [{ appuserKey: 4, access: 'hidden' }] }).success).toBe(false)
    expect(accountSharesWriteSchema.safeParse({ isPrivate: false, shares: [], extra: 1 }).success).toBe(false)
  })

  it('offers Hidden, Can view and Can edit to members and admins, and only Hidden and Can view to a viewer', () => {
    expect(shareChoicesFor(rui)).toEqual(['hidden', 'read', 'write'])
    expect(shareChoicesFor(joao)).toEqual(['hidden', 'read', 'write'])
    expect(shareChoicesFor({ role: 'owner' })).toEqual(['hidden', 'read', 'write'])
    expect(shareChoicesFor(eva)).toEqual(['hidden', 'read'])
  })

  it('starts each member other than the account owner on their effective access, a viewer never above Can view', () => {
    expect(initialShareChoices(shared)).toEqual({ 4: 'write', 5: 'read', 6: 'write' })
    expect(initialShareChoices({ ...shared, isPrivate: true, members: [owner, { ...rui, share: 'read', access: 'read' }, { ...eva, share: 'write', access: 'write' }, { ...joao, access: 'hidden' }] }))
      .toEqual({ 4: 'read', 5: 'read', 6: 'hidden' })
  })

  describe('the PUT body from the per-member control', () => {
    it('sends shared with the household when everyone is at their most (viewers at Can view)', () => {
      expect(buildAccountSharesWrite(shared, { 4: 'write', 5: 'read', 6: 'write' })).toEqual({ isPrivate: false, shares: [] })
    })

    it('sends private with the members who can view or edit when anyone is below their most, leaving Hidden out', () => {
      expect(buildAccountSharesWrite(shared, { 4: 'read', 5: 'read', 6: 'hidden' })).toEqual({
        isPrivate: true,
        shares: [{ appuserKey: 4, access: 'read' }, { appuserKey: 5, access: 'read' }],
      })
      expect(buildAccountSharesWrite(shared, { 4: 'write', 5: 'hidden', 6: 'write' })).toEqual({
        isPrivate: true,
        shares: [{ appuserKey: 4, access: 'write' }, { appuserKey: 6, access: 'write' }],
      })
      expect(buildAccountSharesWrite(shared, { 4: 'hidden', 5: 'hidden', 6: 'hidden' })).toEqual({ isPrivate: true, shares: [] })
    })

    it('never sends Can edit for a viewer, and reads a missing choice as Hidden', () => {
      expect(buildAccountSharesWrite(shared, { 4: 'write', 5: 'write', 6: 'write' })).toEqual({ isPrivate: false, shares: [] })
      expect(buildAccountSharesWrite(shared, { 4: 'write', 6: 'write' })).toEqual({
        isPrivate: true,
        shares: [{ appuserKey: 4, access: 'write' }, { appuserKey: 6, access: 'write' }],
      })
    })

    it('never names the account owner', () => {
      const body = buildAccountSharesWrite(shared, { 3: 'read', 4: 'read', 5: 'read', 6: 'read' })
      expect(body.shares.map((share) => share.appuserKey)).toEqual([4, 5, 6])
    })

    it('sends the plain private toggle when nobody else is in the household', () => {
      const alone: AccountSharesDto = { ...shared, members: [owner] }
      expect(buildAccountSharesWrite(alone, {}, true)).toEqual({ isPrivate: true, shares: [] })
      expect(buildAccountSharesWrite(alone, {}, false)).toEqual({ isPrivate: false, shares: [] })
      expect(buildAccountSharesWrite(alone, {})).toEqual({ isPrivate: false, shares: [] })
    })
  })
})

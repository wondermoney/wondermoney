import { profileNamePayloadSchema, updateProfileNameEndpoint } from './profile-update-contract'

describe('profileNamePayloadSchema', () => {
  it('accepts a single trimmed name field', () => {
    expect(profileNamePayloadSchema.parse({ firstName: '  Ada  ' })).toEqual({ firstName: 'Ada' })
    expect(profileNamePayloadSchema.parse({ lastName: 'Lovelace' })).toEqual({ lastName: 'Lovelace' })
  })

  it('rejects an empty patch and blank/oversized names', () => {
    expect(profileNamePayloadSchema.safeParse({}).success).toBe(false)
    expect(profileNamePayloadSchema.safeParse({ firstName: '   ' }).success).toBe(false)
    expect(profileNamePayloadSchema.safeParse({ firstName: 'x'.repeat(101) }).success).toBe(false)
  })
})

describe('updateProfileNameEndpoint', () => {
  it('targets the principal-scoped user route with a 200 success and undefined body', () => {
    const endpoint = updateProfileNameEndpoint('abc-123')
    expect(endpoint.method).toBe('PATCH')
    expect(endpoint.path).toBe('/v1/user/abc-123')
    expect(endpoint.successStatuses).toEqual([200])
    expect(endpoint.schema.parse(undefined)).toBeUndefined()
  })

  it('encodes an unusual principal id safely into the path', () => {
    expect(updateProfileNameEndpoint('a/b c').path).toBe('/v1/user/a%2Fb%20c')
  })
})

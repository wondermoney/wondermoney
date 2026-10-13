import { deleteAccountEndpoint } from './account-deletion-contract'

describe('deleteAccountEndpoint', () => {
  it('is a bodyless DELETE against the authoritative self endpoint', () => {
    expect(deleteAccountEndpoint.method).toBe('DELETE')
    expect(deleteAccountEndpoint.path).toBe('/v1/user/me')
  })

  it('only accepts the 204 No Content success status', () => {
    expect(deleteAccountEndpoint.successStatuses).toEqual([204])
  })

  it('parses the empty 204 body as undefined and rejects any payload', () => {
    expect(deleteAccountEndpoint.schema.parse(undefined)).toBeUndefined()
    expect(deleteAccountEndpoint.schema.safeParse({ deleted: true }).success).toBe(false)
  })
})

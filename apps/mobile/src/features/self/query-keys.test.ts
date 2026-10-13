import { profileKey } from './query-keys'

describe('self query keys', () => {
  it('uses only namespace, resource, and authenticated epoch', () => {
    expect(profileKey(7)).toEqual(['self', 'profile', 7])
    expect(profileKey(8)).not.toEqual(profileKey(7))
  })
})

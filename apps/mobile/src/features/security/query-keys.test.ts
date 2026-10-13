import { mfaFactorsKey } from './query-keys'

describe('security query keys', () => {
  it('uses only namespace, resource, and authenticated epoch', () => {
    expect(mfaFactorsKey(7)).toEqual(['security', 'mfa-factors', 7])
    expect(mfaFactorsKey(8)).not.toEqual(mfaFactorsKey(7))
  })
})

import { householdKey } from './query-keys'

describe('household query keys', () => {
  it('uses only namespace and authenticated epoch', () => {
    expect(householdKey(7)).toEqual(['household', 7])
    expect(householdKey(8)).not.toEqual(householdKey(7))
  })
})

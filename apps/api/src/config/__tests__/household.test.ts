import { describe, expect, it } from 'vitest';

import { householdMaxMembers } from '../household';

describe('householdMaxMembers', () => {
  it('holds six people when the operator sets nothing', () => {
    expect(householdMaxMembers({})).toBe(6);
  });

  it('takes the operator override', () => {
    expect(householdMaxMembers({ HOUSEHOLD_MAX_MEMBERS: ' 3 ' })).toBe(3);
  });

  it('keeps the default for a value boot validation would refuse', () => {
    expect(householdMaxMembers({ HOUSEHOLD_MAX_MEMBERS: '0' })).toBe(6);
    expect(householdMaxMembers({ HOUSEHOLD_MAX_MEMBERS: 'many' })).toBe(6);
  });
});

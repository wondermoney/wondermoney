import { describe, expect, it } from 'vitest';

import { HouseholdRole } from '@entity/AppuserTenant';

import { householdCan } from '../household-permissions';

const { ADMIN, MEMBER, OWNER, VIEWER } = HouseholdRole;
const ROLES = [OWNER, ADMIN, MEMBER, VIEWER];

describe('householdCan', () => {
  it.each([
    // role, write shared data, leave, manage, transfer ownership
    [OWNER, true, false, true, true],
    [ADMIN, true, true, true, false],
    [MEMBER, true, true, false, false],
    [VIEWER, false, true, false, false],
  ])('%s: write=%s leave=%s manage=%s transfer=%s', (role, write, leave, manage, transfer) => {
    expect(householdCan(role, 'writeSharedData')).toBe(write);
    expect(householdCan(role, 'leave')).toBe(leave);
    expect(householdCan(role, 'manage')).toBe(manage);
    expect(householdCan(role, 'transferOwnership')).toBe(transfer);
  });

  it('allows nothing without a role', () => {
    expect(householdCan(undefined, 'writeSharedData')).toBe(false);
    expect(householdCan(undefined, { kind: 'invite', role: VIEWER })).toBe(false);
  });

  // Who may invite, or resend and revoke an invite, for which role.
  it.each([
    [OWNER, [ADMIN, MEMBER, VIEWER]],
    [ADMIN, [MEMBER, VIEWER]],
    [MEMBER, []],
    [VIEWER, []],
  ])('%s invites and manages invites for exactly %j', (actor, allowed) => {
    for (const role of ROLES) {
      const expected = (allowed).includes(role);
      expect(householdCan(actor, { kind: 'invite', role })).toBe(expected);
      expect(householdCan(actor, { kind: 'manageInvite', role })).toBe(expected);
    }
  });

  it.each([
    [OWNER, [ADMIN, MEMBER, VIEWER]],
    [ADMIN, [MEMBER, VIEWER]],
    [MEMBER, []],
    [VIEWER, []],
  ])('%s removes exactly %j', (actor, allowed) => {
    for (const role of ROLES) {
      expect(householdCan(actor, { kind: 'removeMember', role })).toBe((allowed).includes(role));
    }
  });

  it('lets a manager change only roles below their own, and grant only roles below their own', () => {
    const allowed: string[] = [];
    for (const actor of ROLES) {
      for (const from of ROLES) {
        for (const to of ROLES) {
          if (householdCan(actor, { from, kind: 'changeRole', to })) allowed.push(`${actor}:${from}->${to}`);
        }
      }
    }
    expect(allowed.sort()).toEqual([
      'admin:member->member',
      'admin:member->viewer',
      'admin:viewer->member',
      'admin:viewer->viewer',
      'owner:admin->admin',
      'owner:admin->member',
      'owner:admin->viewer',
      'owner:member->admin',
      'owner:member->member',
      'owner:member->viewer',
      'owner:viewer->admin',
      'owner:viewer->member',
      'owner:viewer->viewer',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { BadRequestError } from '@utils/errors';

import { accountAttributionOf, matchesMemberFilter, parseMemberFilter, transactionAttributionOf } from '../member-attribution';

/*
 * Whose money a row is. The household has an owner (1), a partner (2) and a former member (9) who
 * left; only 1 and 2 are active.
 */
describe('member attribution', () => {
  const active = new Set([1, 2]);
  const ownersAccount = { isJoint: false, ownerAppuserKey: 1 };
  const jointAccount = { isJoint: true, ownerAppuserKey: 1 };
  const formerMembersAccount = { isJoint: false, ownerAppuserKey: 9 };
  const followsAccount = { attributedAppuserKey: null, attributedToShared: false };

  describe('defaults', () => {
    it('gives an existing account to its owner', () => {
      expect(accountAttributionOf(ownersAccount, active)).toBe(1);
    });

    it('gives a transaction with no attribution of its own to its account\'s owner', () => {
      expect(transactionAttributionOf(followsAccount, ownersAccount, active)).toBe(1);
    });

    it('counts a joint account and its transactions as Shared', () => {
      expect(accountAttributionOf(jointAccount, active)).toBeNull();
      expect(transactionAttributionOf(followsAccount, jointAccount, active)).toBeNull();
    });

    it('counts the rows of someone who left the household as Shared', () => {
      expect(accountAttributionOf(formerMembersAccount, active)).toBeNull();
      expect(transactionAttributionOf(followsAccount, formerMembersAccount, active)).toBeNull();
    });
  });

  describe('a transaction\'s own attribution', () => {
    it('wins over its account\'s owner', () => {
      expect(transactionAttributionOf({ attributedAppuserKey: 2, attributedToShared: false }, ownersAccount, active)).toBe(2);
    });

    it('names a member on a joint account', () => {
      expect(transactionAttributionOf({ attributedAppuserKey: 2, attributedToShared: false }, jointAccount, active)).toBe(2);
    });

    it('can make a member\'s spending Shared', () => {
      expect(transactionAttributionOf({ attributedAppuserKey: null, attributedToShared: true }, ownersAccount, active)).toBeNull();
    });

    it('counts as Shared once the member it names has left', () => {
      expect(transactionAttributionOf({ attributedAppuserKey: 9, attributedToShared: false }, ownersAccount, active)).toBeNull();
    });
  });

  describe('the member filter', () => {
    it('keeps everything when absent', () => {
      expect(matchesMemberFilter(1, undefined)).toBe(true);
      expect(matchesMemberFilter(null, undefined)).toBe(true);
    });

    it('keeps the named members and, when asked, Shared', () => {
      const filter = parseMemberFilter(['2', 'shared']);
      expect([1, 2, null].map((attribution) => matchesMemberFilter(attribution, filter))).toEqual([false, true, true]);
    });

    it('reads no values as no filter, and refuses a value that is no key', () => {
      expect(parseMemberFilter([])).toBeUndefined();
      expect(() => parseMemberFilter(['0'])).toThrow(BadRequestError);
    });
  });
});

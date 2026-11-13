import { describe, expect, it } from 'vitest';

import { basisPointsMatching, basisPointsOfPercent, memberPartOf, ownershipPartsOf } from '@service/household/account-ownership';
import { singleMemberFilter } from '@service/household/member-attribution';
import { Money } from '@utils/money';

const OWNER = 1;
const PARTNER = 2;
const KID = 3;
const FORMER = 9;
const active = new Set([KID, OWNER, PARTNER]);
const owned = { isJoint: false, ownerAppuserKey: OWNER };
const joint = { isJoint: true, ownerAppuserKey: OWNER };

const asObject = (parts: ReadonlyMap<null | number, number>) => Object.fromEntries([...parts].map(([holder, basisPoints]) => [holder ?? 'shared', basisPoints]));

describe('who holds an account for net worth', () => {
  it('gives an account with no shares wholly to its owner, or to Shared when it is joint or its owner left', () => {
    expect(asObject(ownershipPartsOf(owned, [], active))).toEqual({ [OWNER]: 10000 });
    expect(asObject(ownershipPartsOf(joint, [], active))).toEqual({ shared: 10000 });
    expect(asObject(ownershipPartsOf({ isJoint: false, ownerAppuserKey: FORMER }, [], active))).toEqual({ shared: 10000 });
  });

  it('splits an account with shares between its holders, joint or not', () => {
    const shares = [{ appuserKey: OWNER, basisPoints: 6000 }, { appuserKey: PARTNER, basisPoints: 4000 }];

    expect(asObject(ownershipPartsOf(owned, shares, active))).toEqual({ [OWNER]: 6000, [PARTNER]: 4000 });
    expect(asObject(ownershipPartsOf(joint, shares, active))).toEqual({ [OWNER]: 6000, [PARTNER]: 4000 });
  });

  it('counts the share of someone who left as Shared', () => {
    const shares = [{ appuserKey: OWNER, basisPoints: 7000 }, { appuserKey: FORMER, basisPoints: 3000 }];

    expect(asObject(ownershipPartsOf(owned, shares, active))).toEqual({ [OWNER]: 7000, shared: 3000 });
  });

  it('keeps the filtered member\'s basis points, and all of them with no filter', () => {
    const parts = ownershipPartsOf(owned, [{ appuserKey: OWNER, basisPoints: 2500 }, { appuserKey: PARTNER, basisPoints: 7500 }], active);

    expect(basisPointsMatching(parts, singleMemberFilter(PARTNER))).toBe(7500);
    expect(basisPointsMatching(parts, singleMemberFilter(KID))).toBe(0);
    expect(basisPointsMatching(parts, singleMemberFilter('shared'))).toBe(0);
    expect(basisPointsMatching(parts, undefined)).toBe(10000);
  });
});

describe('a member\'s part of an account\'s value', () => {
  const thirds = ownershipPartsOf(owned, [{ appuserKey: OWNER, basisPoints: 3333 }, { appuserKey: PARTNER, basisPoints: 3333 }, { appuserKey: KID, basisPoints: 3334 }], active);
  const partOf = (amount: number, filter: Parameters<typeof memberPartOf>[2]) => Money.toNumber(memberPartOf(Money.of(amount, 'EUR'), thirds, filter));

  it('splits the value so the holders\' parts add up to it exactly', () => {
    const parts = [OWNER, PARTNER, KID].map((member) => partOf(100.0001, singleMemberFilter(member)));

    expect(parts).toEqual([33.33, 33.33, 33.3401]);
    expect(Money.toNumber(Money.sum(parts.map((part) => Money.of(part, 'EUR')), 'EUR'))).toBe(100.0001);
    expect(partOf(100.0001, singleMemberFilter('shared'))).toBe(0);
  });

  it('splits a liability the same way, and leaves the value whole with no filter', () => {
    expect([OWNER, PARTNER, KID].map((member) => partOf(-300, singleMemberFilter(member)))).toEqual([-99.99, -99.99, -100.02]);
    expect(partOf(-300, undefined)).toBe(-300);
  });
});

describe('a share as a percentage', () => {
  it('takes up to two decimals from 0 to 100', () => {
    expect(basisPointsOfPercent(60)).toBe(6000);
    expect(basisPointsOfPercent(33.33)).toBe(3333);
    expect(basisPointsOfPercent(0.01)).toBe(1);
    expect(basisPointsOfPercent(0)).toBe(0);
    expect(basisPointsOfPercent(100)).toBe(10000);
  });

  it('refuses more decimals, or a value out of range', () => {
    expect(basisPointsOfPercent(33.333)).toBeNull();
    expect(basisPointsOfPercent(-1)).toBeNull();
    expect(basisPointsOfPercent(100.01)).toBeNull();
    expect(basisPointsOfPercent(Number.NaN)).toBeNull();
  });
});

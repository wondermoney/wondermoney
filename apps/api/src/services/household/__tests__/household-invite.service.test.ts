import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { ERROR_CODE } from '@utils/errors';

import { validateInviteForEmail } from '../household-invite.service';

describe('validateInviteForEmail — says why an invite cannot be used', () => {
  const DAY = 24 * 60 * 60 * 1000;

  function inviteEm(invite: null | Partial<HouseholdInvite>) {
    const flush = vi.fn().mockResolvedValue(undefined);
    const em = {
      getRepository: vi.fn(() => ({ getByToken: vi.fn().mockResolvedValue(invite) })),
      persist: vi.fn().mockReturnValue({ flush }),
    } as unknown as EntityManager;
    return em;
  }

  const pending = (overrides: Partial<HouseholdInvite> = {}): Partial<HouseholdInvite> => ({
    emailAddress: 'partner@wonder.money',
    expiresAt: new Date(Date.now() + DAY),
    status: HouseholdInviteStatus.PENDING,
    ...overrides,
  });

  // The status stays 400 for every case, so a client that only knows the generic
  // `bad_request` still sees a refused signup.
  it.each([
    ['an unknown token', null, ERROR_CODE.INVITE_INVALID],
    ['a revoked invite', pending({ status: HouseholdInviteStatus.REVOKED }), ERROR_CODE.INVITE_INVALID],
    ['an accepted invite', pending({ status: HouseholdInviteStatus.ACCEPTED }), ERROR_CODE.INVITE_ALREADY_USED],
    ['an invite already marked expired', pending({ status: HouseholdInviteStatus.EXPIRED }), ERROR_CODE.INVITE_EXPIRED],
    ['a pending invite past its expiry', pending({ expiresAt: new Date(Date.now() - DAY) }), ERROR_CODE.INVITE_EXPIRED],
    ['an invite sent to another address', pending({ emailAddress: 'someone-else@wonder.money' }), ERROR_CODE.INVITE_EMAIL_MISMATCH],
  ])('refuses %s with its own code', async (_case, invite, code) => {
    await expect(validateInviteForEmail(inviteEm(invite), 'token', 'partner@wonder.money')).rejects.toMatchObject({ code, status: 400 });
  });

  it('accepts a pending invite for the invited address, ignoring case', async () => {
    const invite = pending();
    await expect(validateInviteForEmail(inviteEm(invite), 'token', 'Partner@Wonder.Money')).resolves.toBe(invite);
  });
});

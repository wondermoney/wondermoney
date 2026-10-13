import type { EntityManager } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  fireAndForget: vi.fn(),
  sendRenderedEmail: vi.fn(),
}));

vi.mock('@service/email/email', () => ({ sendRenderedEmail: mocked.sendRenderedEmail }));
vi.mock('@utils/fire-and-forget', () => ({ fireAndForget: mocked.fireAndForget }));

import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { Tenant } from '@entity/Tenant';
import { BadRequestError, ConflictError } from '@utils/errors';

import { consumeInvite, createHouseholdInvite, escapeHtml, HOUSEHOLD_MAX_MEMBERS, notifyExistingUserInviteAttempt } from '../household-invite.service';

function em({
  activeMembers = 1,
  existingUser = null as Appuser | null,
  pendingInvite = null as HouseholdInvite | null,
}: { activeMembers?: number; existingUser?: Appuser | null; pendingInvite?: HouseholdInvite | null } = {}) {
  const flush = vi.fn().mockResolvedValue(undefined);
  const persist = vi.fn().mockReturnValue({ flush });
  const appuserRepo = { getUserByEmail: vi.fn().mockResolvedValue(existingUser) };
  const appuserTenantRepo = { countActiveByTenant: vi.fn().mockResolvedValue(activeMembers) };
  const householdInviteRepo = { getPendingForTenant: vi.fn().mockResolvedValue(pendingInvite) };
  const reposByEntity = new Map<unknown, unknown>([
    [Appuser, appuserRepo],
    [AppuserTenant, appuserTenantRepo],
    [HouseholdInvite, householdInviteRepo],
  ]);
  return {
    em: { getRepository: vi.fn((entity: unknown) => reposByEntity.get(entity)), persist } as unknown as EntityManager,
    flush,
    persist,
  };
}

function inviter(overrides: Partial<Appuser> = {}) {
  return { appuserKey: 1, emailAddress: 'owner@wonder.money', firstName: 'Owner', ...overrides } as Appuser;
}

function tenant(overrides: Partial<Tenant> = {}) {
  return { tenantKey: 10, ...overrides } as Tenant;
}

describe('createHouseholdInvite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects inviting an email that already has an account', async () => {
    const { em: mockEm, persist } = em({ existingUser: { appuserKey: 2, emailAddress: 'partner@wonder.money' } as Appuser });

    await expect(createHouseholdInvite(mockEm, inviter(), tenant(), 'Partner@Wonder.Money')).rejects.toThrow(ConflictError);
    await expect(createHouseholdInvite(mockEm, inviter(), tenant(), 'Partner@Wonder.Money')).rejects.toThrow(/already exists/i);
    expect(persist).not.toHaveBeenCalled();
    expect(mocked.sendRenderedEmail).not.toHaveBeenCalled();
  });

  it('rejects self-invite before checking for an existing account', async () => {
    const { em: mockEm } = em();
    const owner = inviter({ emailAddress: 'owner@wonder.money' });

    await expect(createHouseholdInvite(mockEm, owner, tenant(), 'owner@wonder.money')).rejects.toThrow(BadRequestError);
  });

  it('creates the invite and sends the email when the invitee has no existing account', async () => {
    const { em: mockEm, flush, persist } = em({ existingUser: null });

    const invite = await createHouseholdInvite(mockEm, inviter(), tenant(), 'New.Partner@Wonder.Money');

    expect(invite.emailAddress).toBe('new.partner@wonder.money');
    expect(persist).toHaveBeenCalledWith(invite);
    expect(flush).toHaveBeenCalled();
    expect(mocked.fireAndForget).toHaveBeenCalled();
  });

  it('rejects when the household already has two members', async () => {
    const { em: mockEm } = em({ activeMembers: 2, existingUser: null });

    await expect(createHouseholdInvite(mockEm, inviter(), tenant(), 'new@wonder.money')).rejects.toThrow(ConflictError);
  });
});

/**
 * The invite recipient is fully attacker-chosen and the mail is DKIM-signed by WonderMoney's own
 * domain, so an unescaped display name is a phishing primitive, not a cosmetic bug.
 */
describe('invite email HTML escaping', () => {
  beforeEach(() => vi.clearAllMocks());

  const sentEmail = () => mocked.sendRenderedEmail.mock.calls[0]?.[0] as { html: string; subject: string; text: string };

  it('escapes markup in the inviter display name instead of shipping it into the email body', async () => {
    const { em: mockEm } = em({ existingUser: null });
    const attacker = inviter({ firstName: '<a href="https://evil.tld/login">Security Alert</a>' });

    await createHouseholdInvite(mockEm, attacker, tenant(), 'victim@example.com');

    const { html } = sentEmail();
    expect(html).not.toContain('<a href="https://evil.tld/login">');
    expect(html).toContain('&lt;a href=&quot;https://evil.tld/login&quot;&gt;Security Alert&lt;/a&gt;');
  });

  it('keeps the invite link intact and still renders a single anchor', async () => {
    const { em: mockEm } = em({ existingUser: null });

    const invite = await createHouseholdInvite(mockEm, inviter({ firstName: 'Ada' }), tenant(), 'partner@example.com');

    const { html, text } = sentEmail();
    expect(html).toContain(`/join?token=${invite.token}`);
    expect(html.match(/<a /gu)).toHaveLength(1);
    expect(text).toContain(`/join?token=${invite.token}`);
  });

  it('falls back to the inviter email address and escapes that too', async () => {
    const { em: mockEm } = em({ existingUser: null });
    const attacker = inviter({ emailAddress: '"><script>alert(1)</script>@wonder.money', firstName: undefined });

    await createHouseholdInvite(mockEm, attacker, tenant(), 'victim@example.com');

    expect(sentEmail().html).not.toContain('<script>');
  });

  it('escapes the email address in the internal existing-user alert', () => {
    vi.stubEnv('SUPPORT_EMAIL', 'team@example.com');
    notifyExistingUserInviteAttempt('<img src=x onerror=alert(1)>@example.com', 42);
    vi.unstubAllEnvs();

    expect(sentEmail().html).not.toContain('<img');
    expect(sentEmail().html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sends no existing-user alert when there is no team inbox to send it to', () => {
    vi.stubEnv('SUPPORT_EMAIL', '');
    notifyExistingUserInviteAttempt('person@example.com', 42);
    vi.unstubAllEnvs();

    expect(mocked.sendRenderedEmail).not.toHaveBeenCalled();
  });

  it('escapes every HTML-significant character exactly once', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml('plain name')).toBe('plain name');
  });
});

describe('consumeInvite — single-writer claim', () => {
  /**
   * The bug this guards: validation happens ~44 lines earlier in `controller/auth.ts`, so
   * two concurrent `/join` submissions of the same token both saw PENDING and both created a
   * membership — a three-member household where the cap is two.
   * The claim's rowcount, not the earlier read, is the authority.
   */
  function txEm(claimedRows: number, activeMembers = 1) {
    const createAppuserTenant = vi.fn().mockResolvedValue(undefined);
    const tx = {
      flush: vi.fn().mockResolvedValue(undefined),
      getRepository: vi.fn(() => ({
        countActiveByTenant: vi.fn().mockResolvedValue(activeMembers),
        createAppuserTenant,
        // The invite was just claimed inside this transaction, so it is no longer pending.
        getPendingForTenant: vi.fn().mockResolvedValue(null),
      })),
      nativeUpdate: vi.fn().mockResolvedValue(claimedRows),
    };
    const em = { transactional: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)) };
    return { createAppuserTenant, em, tx };
  }

  const invite = { householdInviteKey: 7, tenantKey: { tenantKey: 3 } } as unknown as HouseholdInvite;
  const member = { appuserKey: 11 } as unknown as Appuser;

  it('creates the membership when the claim wins', async () => {
    const { createAppuserTenant, em, tx } = txEm(1);
    await expect(consumeInvite(em as unknown as EntityManager, invite, member)).resolves.toBeTruthy();
    // Claim is conditional on still being PENDING.
    expect(tx.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ householdInviteKey: 7, status: HouseholdInviteStatus.PENDING }),
      expect.objectContaining({ status: HouseholdInviteStatus.ACCEPTED }),
    );
    expect(createAppuserTenant).toHaveBeenCalledOnce();
  });

  it('creates NO membership when the claim loses the race', async () => {
    const { createAppuserTenant, em } = txEm(0);
    await expect(consumeInvite(em as unknown as EntityManager, invite, member)).rejects.toThrow(/already been used/);
    expect(createAppuserTenant).not.toHaveBeenCalled();
  });

  it('refuses to exceed the seat cap even after winning the claim', async () => {
    // Seats can be taken by a membership created since the invite was issued, so the
    // authoritative check belongs inside the transaction, next to the write.
    const { createAppuserTenant, em } = txEm(1, HOUSEHOLD_MAX_MEMBERS);
    await expect(consumeInvite(em as unknown as EntityManager, invite, member)).rejects.toThrow(/already full/);
    expect(createAppuserTenant).not.toHaveBeenCalled();
  });
});

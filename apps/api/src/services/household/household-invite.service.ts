import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { Tenant } from '@entity/Tenant';
import { sendRenderedEmail } from '@service/email/email';
import { supportInbox } from '@service/email/email-transport';
import { FRONTEND_URL } from '@utils/constants';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import { fireAndForget } from '@utils/fire-and-forget';
import logger from '@utils/logger';

/** Owner + one partner. A pending invite consumes the open seat. */
export const HOUSEHOLD_MAX_MEMBERS = 2;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimal HTML entity escape for values interpolated into hand-built email bodies.
 *
 * The invite email is assembled as a string here rather than rendered through the
 * `@wondermoney/react-email` pipeline (which escapes by default), and the recipient is
 * fully attacker-chosen, so any interpolated value — an inviter's display name, an email
 * address — must be escaped before it reaches the markup. Without this, a display name of
 * `<a href="https://evil.tld">Security Alert</a>` ships as a DKIM-signed phishing email
 * from WonderMoney's own sending domain.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const inviteLink = (token: string) => `${FRONTEND_URL.replace(/\/$/u, '')}/join?token=${token}`;
const normalizeEmail = (email: string) => email.toLowerCase().trim();
// 64 hex chars — opaque, unguessable, single-use.
const generateToken = () => `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

export interface HouseholdView {
  members: { appuserKey: number; emailAddress: string; firstName?: string; role: HouseholdRole }[];
  pendingInvite: null | { email: string; expiresAt: Date; householdInviteKey: number };
}

export interface InviteValidationView {
  email: string;
  expiresAt: Date;
  inviterName: null | string;
}

export async function createHouseholdInvite(em: EntityManager, inviter: Appuser, tenant: Tenant, email: string): Promise<HouseholdInvite> {
  if (await seatsTaken(em, tenant) >= HOUSEHOLD_MAX_MEMBERS) {
    throw new ConflictError('Your household is full — you already have a partner or an outstanding invite.');
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === normalizeEmail(inviter.emailAddress)) {
    throw new BadRequestError("You can't invite yourself.");
  }
  if (await em.getRepository(Appuser).getUserByEmail(normalizedEmail)) {
    throw new ConflictError('An account with this email already exists. Household invites only work for new sign-ups today.');
  }

  const invite = new HouseholdInvite();
  invite.emailAddress = normalizedEmail;
  invite.inviterAppuserKey = inviter;
  invite.tenantKey = tenant;
  invite.token = generateToken();
  invite.status = HouseholdInviteStatus.PENDING;
  invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await em.persist(invite).flush();

  sendInviteEmail(normalizedEmail, inviter, invite.token);
  return invite;
}

export async function getHousehold(em: EntityManager, tenant: Tenant): Promise<HouseholdView> {
  const memberships = await em.getRepository(AppuserTenant).find(
    { deletedAt: undefined, recordActive: true, tenantKey: tenant },
    { populate: ['appuserKey'] },
  );
  const pending = await em.getRepository(HouseholdInvite).getPendingForTenant(tenant);
  return {
    members: memberships.map((m) => ({
      appuserKey: m.appuserKey.appuserKey,
      emailAddress: m.appuserKey.emailAddress,
      firstName: m.appuserKey.firstName,
      role: m.role,
    })),
    pendingInvite: pending
      ? { email: pending.emailAddress, expiresAt: pending.expiresAt, householdInviteKey: pending.householdInviteKey }
      : null,
  };
}

/**
 * Public, pre-signup validation for the /join page. Given only the token,
 * returns who invited them and the invited email (so the UI can greet the
 * invitee and lock the email field). Throws if the token is unknown, already
 * used, or expired. Expired tokens are lazily marked EXPIRED.
 */
export async function getInviteForValidation(em: EntityManager, token: string): Promise<InviteValidationView> {
  const invite = await em.getRepository(HouseholdInvite).findOne(
    { deletedAt: undefined, token },
    { populate: ['inviterAppuserKey'] },
  );
  if (!invite || invite.status !== HouseholdInviteStatus.PENDING) {
    throw new BadRequestError('This invitation is invalid or has already been used.');
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    invite.status = HouseholdInviteStatus.EXPIRED;
    await em.persist(invite).flush();
    throw new BadRequestError('This invitation has expired.');
  }
  return {
    email: invite.emailAddress,
    expiresAt: invite.expiresAt,
    inviterName: invite.inviterAppuserKey.firstName?.trim() || null,
  };
}

export async function resendHouseholdInvite(em: EntityManager, inviter: Appuser, tenant: Tenant, householdInviteKey: number): Promise<HouseholdInvite> {
  const invite = await loadPendingInviteForTenant(em, tenant, householdInviteKey);
  invite.token = generateToken();
  invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await em.persist(invite).flush();
  sendInviteEmail(invite.emailAddress, inviter, invite.token);
  return invite;
}

export async function revokeHouseholdInvite(em: EntityManager, tenant: Tenant, householdInviteKey: number): Promise<void> {
  const invite = await loadPendingInviteForTenant(em, tenant, householdInviteKey);
  invite.status = HouseholdInviteStatus.REVOKED;
  await em.persist(invite).flush();
}

function inviterLabel(inviter: Appuser): string {
  return inviter.firstName?.trim() || inviter.emailAddress;
}

async function loadPendingInviteForTenant(em: EntityManager, tenant: Tenant, householdInviteKey: number): Promise<HouseholdInvite> {
  const invite = await em.getRepository(HouseholdInvite).findOne({ deletedAt: undefined, householdInviteKey, tenantKey: tenant });
  if (!invite) throw new NotFoundError('Invite not found');
  if (invite.status !== HouseholdInviteStatus.PENDING) throw new ConflictError('This invite is no longer pending');
  return invite;
}

async function seatsTaken(em: EntityManager, tenant: Tenant): Promise<number> {
  const activeMembers = await em.getRepository(AppuserTenant).countActiveByTenant(tenant);
  const pending = await em.getRepository(HouseholdInvite).getPendingForTenant(tenant);
  return activeMembers + (pending ? 1 : 0);
}

function sendInviteEmail(email: string, inviter: Appuser, token: string): void {
  const label = inviterLabel(inviter);
  const link = inviteLink(token);
  // The subject is plain text (no markup), so it carries the raw label; the HTML body and every
  // attribute value are escaped. The link is built from FRONTEND_URL + a generated hex token,
  // so it carries no caller-controlled input, but it is escaped for uniformity.
  const subject = `${label} invited you to their WonderMoney household`;
  const html = `<p>${escapeHtml(label)} invited you to share their household on WonderMoney — both partners, real-time shared finances.</p>`
    + `<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`
    + `<p>This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>`;
  const text = `${label} invited you to share their WonderMoney household.\n\nAccept: ${link}\n\nThis link expires in 7 days.`;
  fireAndForget(sendRenderedEmail({ headers: {}, html, subject, text, to: { email } }), { email, scope: 'household-invite' });
}

/**
 * A3 — validate an invite token for a NEW signup. Throws if the token is unknown,
 * not pending, expired, or the signup email doesn't match the invited email.
 * Expired tokens are lazily marked EXPIRED.
 */
export async function validateInviteForSignup(em: EntityManager, token: string, signupEmail: string): Promise<HouseholdInvite> {
  const invite = await em.getRepository(HouseholdInvite).getByToken(token);
  if (!invite || invite.status !== HouseholdInviteStatus.PENDING) {
    throw new BadRequestError('This invitation is invalid or has already been used.');
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    invite.status = HouseholdInviteStatus.EXPIRED;
    await em.persist(invite).flush();
    throw new BadRequestError('This invitation has expired.');
  }
  if (normalizeEmail(invite.emailAddress) !== normalizeEmail(signupEmail)) {
    throw new BadRequestError('This invitation was sent to a different email address.');
  }
  return invite;
}

/** A3 — link the new member into the owner's tenant and mark the invite accepted. */
/**
 * Consume a validated invite: claim it, then create the membership.
 *
 * RAD-audit: this was check-then-act. `validateInviteForSignup` confirms the invite is
 * PENDING ~44 lines earlier in `controller/auth.ts`, and this function then created the
 * membership and set ACCEPTED with no transaction, no conditional update and no rowcount
 * check. Two concurrent `/join` submissions of the same token — a double-click, or a client
 * retry — both passed validation and both created a membership, producing a three-member
 * household capped at two. Nothing backstopped it: no constraint counts seats.
 *
 * The invite is now claimed by a conditional UPDATE whose rowcount is the authority — the
 * same single-writer pattern used for the lifecycle email claims. The claim and the
 * membership insert share one transaction, so a failure to create the membership releases
 * the invite rather than burning it.
 */
export async function consumeInvite(em: EntityManager, invite: HouseholdInvite, newMember: Appuser): Promise<Tenant> {
  const tenant = invite.tenantKey;

  return em.transactional(async (tx) => {
    // Claim first. Rowcount 1 means this call won the race; 0 means another request already
    // consumed it, which is a conflict rather than a silent second membership.
    const claimed = await tx.nativeUpdate(
      HouseholdInvite,
      { householdInviteKey: invite.householdInviteKey, status: HouseholdInviteStatus.PENDING },
      { acceptedAt: new Date(), status: HouseholdInviteStatus.ACCEPTED },
    );
    if (claimed !== 1) {
      throw new ConflictError('This invite has already been used.');
    }

    // Re-check the seat cap inside the transaction. The pre-signup check in
    // `createHouseholdInvite` counts pending invites, but seats can also be taken by a
    // membership created since — so the authoritative check belongs here, next to the write.
    if (await seatsTaken(tx, tenant) >= HOUSEHOLD_MAX_MEMBERS) {
      throw new ConflictError('This household is already full.');
    }

    await tx.getRepository(AppuserTenant).createAppuserTenant(newMember, tenant, HouseholdRole.MEMBER);
    await tx.flush();
    return tenant;
  });
}

/**
 * Q2 — an existing WonderMoney user tried to accept an invite (not supported yet).
 * Fire an internal alert so the team can gauge demand for a future merge feature.
 */
export function notifyExistingUserInviteAttempt(email: string, existingAppuserKey: number): void {
  const inbox = supportInbox();
  if (!inbox) {
    logger.info({ existingAppuserKey }, 'Existing user tried to accept a household invite; SUPPORT_EMAIL is not set, so no alert was emailed');
    return;
  }
  const html = `<p>An existing WonderMoney user tried to accept a household invite (not yet supported).</p>`
    + `<p>Email: ${escapeHtml(email)} · appuserKey: ${existingAppuserKey}</p>`;
  fireAndForget(
    sendRenderedEmail({
      headers: {},
      html,
      subject: '[Household] Existing user tried to accept an invite',
      text: `Existing user tried to accept a household invite. Email: ${email}, appuserKey: ${existingAppuserKey}`,
      to: { email: inbox },
    }),
    { email, scope: 'household-existing-user-alert' },
  );
}

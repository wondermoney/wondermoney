import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/core';
import { renderHouseholdInviteEmail } from '@wondermoney/react-email';

import { householdMaxMembers } from '@config/household';
import { instanceName } from '@config/instance-name';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { Tenant } from '@entity/Tenant';
import { sendRenderedEmail } from '@service/email/email';
import { accountLocale, copyLocale } from '@utils/account-language';
import { FRONTEND_URL } from '@utils/constants';
import { BadRequestError, ConflictError, ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';
import { fireAndForget } from '@utils/fire-and-forget';

import { findActiveMembership, type HouseholdMemberView, lockTenant, ownerKeyOf, revokeBankConnectionsOf, toMemberView } from './household-membership.service';
import { householdCan } from './household-permissions';

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
/** The invite email is written in English, Portuguese and Spanish. */
const INVITE_EMAIL_LOCALES = ['en', 'pt', 'es'] as const;

const normalizeEmail = (email: string) => email.toLowerCase().trim();
// 64 hex chars — opaque, unguessable, single-use.
const generateToken = () => `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

export interface HouseholdView {
  /** `HOUSEHOLD_MAX_MEMBERS`: members and pending invites together never exceed it. */
  maxMembers: number;
  /** Every active member, the owner first, then in the order they joined. */
  members: HouseholdMemberView[];
  /**
   * The first of `pendingInvites`, in the shape clients from before roles read. Deprecated: kept
   * for one release so older mobile builds keep working; remove it after that.
   */
  pendingInvite: null | { email: string; expiresAt: Date; householdInviteKey: number };
  /** Every pending, unexpired invite, newest first. */
  pendingInvites: PendingInviteView[];
  /** The caller, so a client can tell which member is "you". */
  viewerAppuserKey: number;
}

export interface InviteValidationView {
  email: string;
  expiresAt: Date;
  /** The household's name, when it has one. */
  householdName: null | string;
  inviterName: null | string;
  role: HouseholdRole;
}

export interface PendingInviteView {
  email: string;
  expiresAt: Date;
  householdInviteKey: number;
  role: HouseholdRole;
}

/**
 * Invite someone into the household with a role. Owners and admins invite, each only for roles
 * below their own. The seat count and the insert run under the household's lock, so two invites
 * sent at once cannot both take the last seat.
 */
export async function createHouseholdInvite(
  em: EntityManager,
  inviter: Appuser,
  inviterRole: HouseholdRole | undefined,
  tenant: Tenant,
  email: string,
  role: HouseholdRole = HouseholdRole.MEMBER,
): Promise<HouseholdInvite> {
  if (!householdCan(inviterRole, { kind: 'invite', role })) {
    throw new ForbiddenError('You can only invite people with a role below yours.', ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED);
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === normalizeEmail(inviter.emailAddress)) {
    throw new BadRequestError("You can't invite yourself.");
  }
  const existing = await em.getRepository(Appuser).getUserByEmail(normalizedEmail);
  // The demo account is shared and read-only: it never joins a household.
  if (existing?.accountType === AppuserAccountType.DEMO) {
    throw new BadRequestError('This account cannot join a household.');
  }

  const invite = await em.transactional(async (tx) => {
    const locked = await lockTenant(tx, tenant.tenantKey);
    if (existing && await findActiveMembership(tx, locked, existing.appuserKey)) {
      throw new ConflictError('This person is already in your household.', ERROR_CODE.ALREADY_HOUSEHOLD_MEMBER);
    }
    const pending = await pendingInvitesOf(tx, locked);
    if (pending.some((other) => other.emailAddress === normalizedEmail)) {
      throw new ConflictError('This person already has a pending invite. Resend it instead.');
    }
    if (await seatsTaken(tx, locked, pending) >= householdMaxMembers()) {
      throw new ConflictError('Your household is full: members and pending invites take every seat.', ERROR_CODE.HOUSEHOLD_FULL);
    }
    const created = tx.create(HouseholdInvite, {
      emailAddress: normalizedEmail,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      inviterAppuserKey: inviter,
      role,
      status: HouseholdInviteStatus.PENDING,
      tenantKey: locked,
      token: generateToken(),
    }, { partial: true });
    await tx.flush();
    return created;
  });

  sendInviteEmail(normalizedEmail, inviter, invite.token);
  return invite;
}

export async function getHousehold(em: EntityManager, tenant: Tenant, viewerAppuserKey: number): Promise<HouseholdView> {
  const memberships = await em.getRepository(AppuserTenant).find(
    { deletedAt: null, recordActive: true, tenantKey: tenant },
    { orderBy: { appuserTenantKey: 'ASC' }, populate: ['appuserKey'] },
  );
  const isOwner = (member: HouseholdMemberView) => Number(member.role === HouseholdRole.OWNER);
  const members = memberships.map(toMemberView).sort((a, b) => isOwner(b) - isOwner(a));
  const pendingInvites = (await pendingInvitesOf(em, tenant))
    .sort((a, b) => b.householdInviteKey - a.householdInviteKey)
    .map((invite) => ({ email: invite.emailAddress, expiresAt: invite.expiresAt, householdInviteKey: invite.householdInviteKey, role: invite.role }));
  const first = pendingInvites[0];
  return {
    maxMembers: householdMaxMembers(),
    members,
    pendingInvite: first ? { email: first.email, expiresAt: first.expiresAt, householdInviteKey: first.householdInviteKey } : null,
    pendingInvites,
    viewerAppuserKey,
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
    { deletedAt: null, token },
    { populate: ['inviterAppuserKey', 'tenantKey'] },
  );
  if (invite?.status !== HouseholdInviteStatus.PENDING) {
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
    householdName: invite.tenantKey.name?.trim() || null,
    inviterName: invite.inviterAppuserKey.firstName?.trim() || null,
    role: invite.role,
  };
}

export async function resendHouseholdInvite(
  em: EntityManager,
  inviter: Appuser,
  inviterRole: HouseholdRole | undefined,
  tenant: Tenant,
  householdInviteKey: number,
): Promise<HouseholdInvite> {
  const invite = await loadPendingInviteForTenant(em, tenant, householdInviteKey, inviterRole);
  invite.token = generateToken();
  invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await em.persist(invite).flush();
  sendInviteEmail(invite.emailAddress, inviter, invite.token);
  return invite;
}

export async function revokeHouseholdInvite(em: EntityManager, tenant: Tenant, actorRole: HouseholdRole | undefined, householdInviteKey: number): Promise<void> {
  const invite = await loadPendingInviteForTenant(em, tenant, householdInviteKey, actorRole);
  invite.status = HouseholdInviteStatus.REVOKED;
  await em.persist(invite).flush();
}

function inviterLabel(inviter: Appuser): string {
  return inviter.firstName?.trim() || inviter.emailAddress;
}

async function loadPendingInviteForTenant(em: EntityManager, tenant: Tenant, householdInviteKey: number, actorRole: HouseholdRole | undefined): Promise<HouseholdInvite> {
  const invite = await em.getRepository(HouseholdInvite).findOne({ deletedAt: null, householdInviteKey, tenantKey: tenant });
  if (!invite) throw new NotFoundError('Invite not found');
  if (!householdCan(actorRole, { kind: 'manageInvite', role: invite.role })) {
    throw new ForbiddenError('You can only manage invites for roles below yours.', ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED);
  }
  if (invite.status !== HouseholdInviteStatus.PENDING) throw new ConflictError('This invite is no longer pending');
  return invite;
}

/** Pending invites that still hold a seat: a lapsed one stops counting before it is marked expired. */
function pendingInvitesOf(em: EntityManager, tenant: Tenant): Promise<HouseholdInvite[]> {
  return em.find(HouseholdInvite, {
    deletedAt: null,
    expiresAt: { $gt: new Date() },
    status: HouseholdInviteStatus.PENDING,
    tenantKey: tenant,
  });
}

/** Seats taken: active members plus pending invites. Call under `lockTenant`. */
async function seatsTaken(em: EntityManager, tenant: Tenant, pending: HouseholdInvite[]): Promise<number> {
  const activeMembers = await em.getRepository(AppuserTenant).countActiveByTenant(tenant);
  return activeMembers + pending.length;
}

/**
 * The email is in the inviter's language (`Appuser.language`): the invitee may have no account
 * yet. Its link opens the join page in the inviter's locale, where an existing account signs in
 * and confirms.
 */
function sendInviteEmail(email: string, inviter: Appuser, token: string): void {
  const send = async () => {
    const rendered = await renderHouseholdInviteEmail({
      acceptUrl: `${FRONTEND_URL.replace(/\/$/u, '')}/${accountLocale(inviter.language)}/join?token=${token}`,
      brandName: instanceName(),
      expiresInDays: INVITE_TTL_DAYS,
      inviterName: inviterLabel(inviter),
      language: copyLocale(inviter.language, INVITE_EMAIL_LOCALES),
    });
    return sendRenderedEmail({ headers: {}, html: rendered.html, subject: rendered.subject, text: rendered.text, to: { email } });
  };
  fireAndForget(send(), { email, scope: 'household-invite' });
}

/**
 * Validate an invite token for the person it was sent to: a new signup, or a signed-in user
 * accepting it. Throws if the token is unknown, not pending, expired, or the email doesn't match
 * the invited email. Expired tokens are lazily marked EXPIRED.
 */
export async function validateInviteForEmail(em: EntityManager, token: string, email: string): Promise<HouseholdInvite> {
  // Each refusal carries its own code so the client can say what went wrong; the status
  // stays 400, which is all a client from before the codes looked at.
  const invite = await em.getRepository(HouseholdInvite).getByToken(token);
  if (invite?.status === HouseholdInviteStatus.ACCEPTED) {
    throw new BadRequestError('This invitation has already been used.', ERROR_CODE.INVITE_ALREADY_USED);
  }
  if (invite?.status === HouseholdInviteStatus.EXPIRED) {
    throw new BadRequestError('This invitation has expired.', ERROR_CODE.INVITE_EXPIRED);
  }
  if (invite?.status !== HouseholdInviteStatus.PENDING) {
    throw new BadRequestError('This invitation is invalid or has been revoked.', ERROR_CODE.INVITE_INVALID);
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    invite.status = HouseholdInviteStatus.EXPIRED;
    await em.persist(invite).flush();
    throw new BadRequestError('This invitation has expired.', ERROR_CODE.INVITE_EXPIRED);
  }
  if (normalizeEmail(invite.emailAddress) !== normalizeEmail(email)) {
    throw new BadRequestError('This invitation was sent to a different email address.', ERROR_CODE.INVITE_EMAIL_MISMATCH);
  }
  return invite;
}

/**
 * Claim a validated invite inside `tx` and check the seat it is for. The claim is a conditional
 * UPDATE whose rowcount is the authority, so two submissions of the same token (a double-click, a
 * retry) cannot both join. The seat check counts active members under the household's lock, so
 * accepts of *different* invites at once cannot push the household past `HOUSEHOLD_MAX_MEMBERS`
 * either: they queue on the lock and the late one sees the earlier one's member. Pending invites
 * are not counted here: each was given a seat when it was sent.
 */
async function claimInviteSeat(tx: EntityManager, invite: HouseholdInvite): Promise<Tenant> {
  const tenant = await lockTenant(tx, invite.tenantKey.tenantKey);
  const claimed = await tx.nativeUpdate(
    HouseholdInvite,
    { expiresAt: { $gt: new Date() }, householdInviteKey: invite.householdInviteKey, status: HouseholdInviteStatus.PENDING },
    { acceptedAt: new Date(), status: HouseholdInviteStatus.ACCEPTED },
  );
  if (claimed !== 1) {
    throw new ConflictError('This invite has already been used.', ERROR_CODE.INVITE_ALREADY_USED);
  }
  if (await tx.getRepository(AppuserTenant).countActiveByTenant(tenant) >= householdMaxMembers()) {
    throw new ConflictError('This household is already full.', ERROR_CODE.HOUSEHOLD_FULL);
  }
  return tenant;
}

/**
 * A new signup joins through its invite: claim it, then create the membership with the invite's
 * role. The claim and the insert share one transaction, so a failure to create the membership
 * releases the invite rather than burning it.
 */
export async function consumeInvite(em: EntityManager, invite: HouseholdInvite, newMember: Appuser): Promise<Tenant> {
  return em.transactional(async (tx) => {
    const tenant = await claimInviteSeat(tx, invite);
    await tx.getRepository(AppuserTenant).createAppuserTenant(newMember, tenant, invite.role);
    await tx.flush();
    return tenant;
  });
}

/**
 * Whether a household holds accounts (bank, cash, card, investment, loan or asset) or
 * transactions. An existing user joins another household only from one that holds none: nothing
 * is merged, and nothing they own would be left where they can no longer see it.
 */
export async function householdHoldsMoneyData(em: EntityManager, tenantKey: number): Promise<boolean> {
  const [row] = await em.getConnection().execute<{ busy: boolean }[]>(
    `select (exists(select 1 from "account" where "tenant_key" = ? and "deleted_at" is null)
      or exists(select 1 from "transaction" where "tenant_key" = ? and "deleted_at" is null)
      or exists(select 1 from "portfolio" where "tenant_key" = ? and "deleted_at" is null)
      or exists(select 1 from "loan" where "tenant_key" = ? and "deleted_at" is null)
      or exists(select 1 from "manual_asset" where "tenant_key" = ? and "deleted_at" is null)) as "busy"`,
    [tenantKey, tenantKey, tenantKey, tenantKey, tenantKey],
    'all',
    em.getTransactionContext(),
  );
  return row?.busy === true;
}

/**
 * A signed-in, existing user accepts an invite: the explicit confirmation of the /join screen.
 * Nothing moves without this call — signing in with an invite token joins nothing.
 *
 * First version: allowed only from a household that holds no accounts or transactions (no data
 * is merged), and not by the owner of a household that has other members. Their old membership
 * ends, their bank connections there are revoked and, if they owned it, its pending invites are
 * revoked; whatever else they set up there (budgets, categories, rules) stays behind with the
 * empty household. They join with the invite's role, under the same seat rule as a signup.
 */
export async function acceptInviteAsExistingUser(em: EntityManager, user: Appuser, currentTenant: Tenant, token: string): Promise<Tenant> {
  const invite = await validateInviteForEmail(em, token, user.emailAddress);
  const targetKey = invite.tenantKey.tenantKey;
  if (targetKey === currentTenant.tenantKey) {
    throw new ConflictError('You are already in this household.', ERROR_CODE.ALREADY_HOUSEHOLD_MEMBER);
  }

  return em.transactional(async (tx) => {
    // Both households are locked, in key order so two people swapping households cannot deadlock.
    const [first, second] = [currentTenant.tenantKey, targetKey].sort((a, b) => a - b) as [number, number];
    await lockTenant(tx, first);
    await lockTenant(tx, second);
    const source = await lockTenant(tx, currentTenant.tenantKey);

    const current = await findActiveMembership(tx, source, user.appuserKey);
    if (!current) throw new ConflictError('Your household membership changed. Reload and try again.');
    const others = await tx.count(AppuserTenant, { appuserKey: { appuserKey: { $ne: user.appuserKey } }, deletedAt: null, recordActive: true, tenantKey: source });
    if (ownerKeyOf(source) === user.appuserKey && others > 0) {
      throw new ConflictError('You own a household with other members. Transfer ownership or remove them first.', ERROR_CODE.HOUSEHOLD_HAS_MEMBERS);
    }
    if (await householdHoldsMoneyData(tx, source.tenantKey)) {
      throw new ConflictError('Your household has accounts or transactions. Joining another household needs an empty one; nothing is merged.', ERROR_CODE.HOUSEHOLD_HAS_DATA);
    }

    const target = await claimInviteSeat(tx, invite);
    const now = new Date();
    current.recordActive = false;
    current.deletedAt = now;
    await revokeBankConnectionsOf(tx, source, user.appuserKey, now);
    if (ownerKeyOf(source) === user.appuserKey) {
      await tx.nativeUpdate(HouseholdInvite, { status: HouseholdInviteStatus.PENDING, tenantKey: source }, { status: HouseholdInviteStatus.REVOKED });
    }
    tx.create(AppuserTenant, { appuserKey: user, recordActive: true, role: invite.role, tenantKey: target }, { partial: true });
    await tx.flush();
    return target;
  });
}

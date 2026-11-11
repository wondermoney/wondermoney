import { createHash, randomBytes } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { ApiToken, type ApiTokenScope } from '@entity/ApiToken';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import type { Tenant } from '@entity/Tenant';

export const API_TOKEN_PREFIX = 'wm_pat_';
/** 32 random bytes, base62-encoded: 43 characters at the top end. */
const API_TOKEN_RANDOM_BYTES = 32;
const API_TOKEN_PREFIX_DISPLAY_LENGTH = 8;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Update `lastUsedAt` at most once a minute, so a busy script does not write on every request. */
export const API_TOKEN_LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * The calendar feed's credential.
 *
 * A subscription that silently expires would stop a person's calendar, so it lasts ten years.
 * It is still revocable, and "reset link" rotates it in one action.
 */
export const CALENDAR_FEED_TOKEN_SCOPE: ApiTokenScope = 'calendar:read';
export const CALENDAR_FEED_TOKEN_NAME = 'Calendar feed';
export const CALENDAR_FEED_TOKEN_EXPIRY_DAYS = 3650;

export interface AuthenticatedApiToken {
  apiToken: ApiToken;
  appuser: Appuser;
  tenant: Tenant;
}

export interface CreatedApiToken {
  /** The plain token. Returned once, at creation, and never stored. */
  apiToken: ApiToken;
  token: string;
}

/** Encode bytes as base62, left-padded so the length is stable for a given byte count. */
export function encodeBase62(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    const digit = Number(value % 62n);
    encoded = `${BASE62.charAt(digit)}${encoded}`;
    value /= 62n;
  }
  // 32 bytes is at most 43 base62 characters; pad so a leading zero byte cannot shorten it.
  return encoded.padStart(43, '0');
}

/** `wm_pat_` plus 43 base62 characters. */
export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${encodeBase62(randomBytes(API_TOKEN_RANDOM_BYTES))}`;
}

/** SHA-256 hex digest. The only form of the token that is ever persisted. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The display fragment stored beside the hash: `wm_pat_` plus the first eight random characters. */
export interface CreateApiTokenInput {
  appuser: Appuser;
  expiresInDays: number;
  name: string;
  scopes: ApiTokenScope[];
  tenant: Tenant;
}

export function apiTokenDisplayPrefix(token: string): string {
  return `${API_TOKEN_PREFIX}${token.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_DISPLAY_LENGTH)}`;
}

export function isApiTokenShaped(value: null | string | undefined): value is string {
  return typeof value === 'string' && value.startsWith(API_TOKEN_PREFIX);
}

/** Create a token and persist only its prefix and hash. */
export async function createApiToken(
  input: CreateApiTokenInput,
  em: EntityManager = DI.em,
): Promise<CreatedApiToken> {
  const token = generateApiToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  const apiToken = em.create(ApiToken, {
    appuserKey: input.appuser,
    expiresAt,
    name: input.name,
    prefix: apiTokenDisplayPrefix(token),
    scopes: input.scopes,
    secretHash: hashApiToken(token),
    tenantKey: input.tenant,
  }, { partial: true });
  await em.persist(apiToken).flush();
  return { apiToken, token };
}

/**
 * Resolve a plain token to its row, or `null` when it is unknown, expired, revoked or deleted.
 *
 * The lookup is by hash and deliberately runs with filters disabled: it happens before the
 * tenant context exists, and the hash is the credential. The caller then arms the normal
 * tenant and privacy rules by setting `req.tenant` from the token's own household.
 */
export interface ApiTokenDto {
  createdAt: string;
  expiresAt: string;
  id: number;
  lastUsedAt: null | string;
  lastUsedIp: null | string;
  name: string;
  prefix: string;
  revokedAt: null | string;
  scopes: ApiTokenScope[];
}

export async function authenticateApiToken(
  token: string,
  options: { ip?: string; now?: Date } = {},
  em: EntityManager = DI.em,
): Promise<AuthenticatedApiToken | null> {
  if (!isApiTokenShaped(token)) return null;

  const now = options.now ?? new Date();
  const apiToken = await em.findOne(
    ApiToken,
    {
      deletedAt: null,
      expiresAt: { $gt: now },
      revokedAt: null,
      secretHash: hashApiToken(token),
    },
    { filters: false, populate: ['appuserKey', 'tenantKey'] },
  );
  if (!apiToken) return null;

  const appuser = apiToken.appuserKey as Appuser;
  const tenant = apiToken.tenantKey as Tenant;
  if (appuser.deletedAt || !appuser.recordActive) return null;
  if (tenant.deletedAt || !tenant.recordActive) return null;

  // A token is bound to the household it was created in. If the member has since left, the
  // membership row is inactive and the token must stop working with it.
  const membership = await em.findOne(
    AppuserTenant,
    { appuserKey: appuser, recordActive: true, tenantKey: tenant },
    { filters: false },
  );
  if (!membership) return null;

  // At most once a minute: a script polling every second must not turn every request into a write.
  const lastUsedAt = apiToken.lastUsedAt?.getTime() ?? 0;
  if (now.getTime() - lastUsedAt >= API_TOKEN_LAST_USED_WRITE_INTERVAL_MS) {
    await em.nativeUpdate(
      ApiToken,
      { apiTokenKey: apiToken.apiTokenKey },
      { lastUsedAt: now, lastUsedIp: options.ip?.slice(0, 64) },
    );
  }

  return { apiToken, appuser, tenant };
}

export function toApiTokenDto(apiToken: ApiToken): ApiTokenDto {
  return {
    createdAt: apiToken.createdAt.toISOString(),
    expiresAt: apiToken.expiresAt.toISOString(),
    id: apiToken.apiTokenKey,
    lastUsedAt: apiToken.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: apiToken.lastUsedIp ?? null,
    name: apiToken.name,
    prefix: apiToken.prefix,
    revokedAt: apiToken.revokedAt?.toISOString() ?? null,
    scopes: apiToken.scopes,
  };
}

/** The member's active calendar feed token, or `null` when they have none. */
export async function findActiveCalendarFeedToken(
  appuser: Appuser,
  em: EntityManager = DI.em,
): Promise<ApiToken | null> {
  const tokens = await em.find(
    ApiToken,
    { appuserKey: appuser, deletedAt: null, revokedAt: null },
    { orderBy: { createdAt: 'desc' } },
  );
  return tokens.find((token) => token.scopes.includes(CALENDAR_FEED_TOKEN_SCOPE)) ?? null;
}

/**
 * Revoke every active calendar feed token of a member, optionally sparing one row.
 *
 * `exceptKey` lets a rotation create the replacement first and then retire the old links, so a
 * failure between the two leaves the previous link working instead of locking the person out of
 * their own calendar.
 */
export async function revokeCalendarFeedTokens(
  appuser: Appuser,
  options: { exceptKey?: number; now?: Date } = {},
  em: EntityManager = DI.em,
): Promise<number> {
  const tokens = await em.find(ApiToken, { appuserKey: appuser, deletedAt: null, revokedAt: null });
  const revokedAt = options.now ?? new Date();
  const calendarTokens = tokens.filter(
    (token) => token.scopes.includes(CALENDAR_FEED_TOKEN_SCOPE) && token.apiTokenKey !== options.exceptKey,
  );
  for (const token of calendarTokens) token.revokedAt = revokedAt;
  if (calendarTokens.length > 0) await em.flush();
  return calendarTokens.length;
}

/**
 * Issue a fresh calendar link and retire the previous one in the same action.
 *
 * The plain token is returned once; the settings page can copy the link only now.
 */
export async function rotateCalendarFeedToken(
  input: { appuser: Appuser; tenant: Tenant },
  em: EntityManager = DI.em,
): Promise<CreatedApiToken> {
  const created = await createApiToken(
    {
      appuser: input.appuser,
      expiresInDays: CALENDAR_FEED_TOKEN_EXPIRY_DAYS,
      name: CALENDAR_FEED_TOKEN_NAME,
      scopes: [CALENDAR_FEED_TOKEN_SCOPE],
      tenant: input.tenant,
    },
    em,
  );
  await revokeCalendarFeedTokens(input.appuser, { exceptKey: created.apiToken.apiTokenKey }, em);
  return created;
}

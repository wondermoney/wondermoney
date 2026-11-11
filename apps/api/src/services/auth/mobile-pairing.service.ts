import { createHash, randomBytes } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { MobilePairing } from '@entity/MobilePairing';
import {
  type AuthSessionSummary,
  createPairedSession,
  deleteAuthSession,
  listAuthSessions,
  type PairedSession,
} from '@service/auth/better-auth';
import { NotFoundError } from '@utils/errors';

/**
 * QR pairing between a signed-in web session and the mobile app.
 *
 * The web session creates a code; the QR carries it; the phone exchanges it for a session.
 * Only the code's SHA-256 hash is stored, so a database read cannot replay a live QR.
 */

/** A pairing code is valid for two minutes, from creation to claim. */
export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000;

/** The app's URL scheme (`app.config.ts`). The QR is a deep link, not an HTTP URL. */
export const PAIRING_URL_SCHEME = 'wondermoney';

/** 32 random bytes, base64url: 43 characters. Guessing one is not a realistic attack. */
const PAIRING_CODE_BYTES = 32;

export interface PairingCode {
  /** The plain code. Shown once, inside the QR, and never stored. */
  code: string;
  expiresAt: Date;
  /** `wondermoney://pair?server=…&code=…`, the QR's contents. */
  url: string;
}

/** The better-auth session operations pairing needs, injectable so tests need no auth server. */
export interface MobileSessionPort {
  createSession: (input: { ipAddress?: null | string; userAgent?: null | string; userId: string; }) => Promise<PairedSession>;
  deleteSession: (sessionId: string) => Promise<void>;
  listSessions: (sessionIds: string[]) => Promise<AuthSessionSummary[]>;
}

export const betterAuthMobileSessionPort: MobileSessionPort = {
  createSession: createPairedSession,
  deleteSession: deleteAuthSession,
  listSessions: listAuthSessions,
};

export interface MobileDevice {
  /** The better-auth session id. Revoking by it ends that session. */
  id: string;
  label: string;
  lastSeenAt: Date;
  pairedAt: Date;
}

export const generatePairingCode = (): string => randomBytes(PAIRING_CODE_BYTES).toString('base64url');

/** SHA-256 hex digest. The only form of the code that is ever persisted. */
export const hashPairingCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/**
 * The QR payload. `server` is the API the phone must reach; `code` is the single-use secret.
 * Nothing long-lived travels in it — the session is created on the exchange, not here.
 */
export function buildPairingUrl(serverUrl: string, code: string): string {
  const query = new URLSearchParams({ code, server: serverUrl });
  return `${PAIRING_URL_SCHEME}://pair?${query.toString()}`;
}

/** Create a single-use code for `appuser`, valid until `now + PAIRING_CODE_TTL_MS`. */
export type ClaimPairingCodeResult =
  | { device: MobileDevice; session: PairedSession; status: 'paired' }
  | { status: 'invalid' };

export async function createPairingCode(
  input: { appuser: Appuser; serverUrl: string },
  options: { em?: EntityManager; now?: Date } = {},
): Promise<PairingCode> {
  const em = options.em ?? DI.em;
  const now = options.now ?? new Date();
  const code = generatePairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);

  em.persist(em.create(MobilePairing, {
    appuserKey: input.appuser,
    codeHash: hashPairingCode(code),
    expiresAt,
  }, { partial: true }));
  await em.flush();

  return { code, expiresAt, url: buildPairingUrl(input.serverUrl, code) };
}

/**
 * Exchange a code for a new mobile session.
 *
 * The claim is one conditional `UPDATE … WHERE claimed_at IS NULL AND expires_at > now`, so
 * two concurrent exchanges of the same code cannot both create a session: exactly one sees a
 * row count of 1 and the other is told the code is invalid. Expiry is checked in the same
 * statement, so a code cannot win a race against its own deadline.
 *
 * A code that has been claimed but whose session could not be created stays claimed: burning
 * it is the safe failure, and the person scans again.
 */
export async function claimPairingCode(
  input: { code: string; ipAddress?: null | string; userAgent?: null | string },
  options: { em?: EntityManager; now?: Date; sessions?: MobileSessionPort } = {},
): Promise<ClaimPairingCodeResult> {
  const em = options.em ?? DI.em;
  const sessions = options.sessions ?? betterAuthMobileSessionPort;
  const now = options.now ?? new Date();

  const claimed = await em.nativeUpdate(
    MobilePairing,
    {
      claimedAt: null,
      codeHash: hashPairingCode(input.code),
      deletedAt: null,
      expiresAt: { $gt: now },
    },
    { claimedAt: now },
  );
  if (claimed === 0) return { status: 'invalid' };

  const pairing = await em.findOne(MobilePairing, { codeHash: hashPairingCode(input.code) });
  if (!pairing) return { status: 'invalid' };

  const appuser = await em.findOne(Appuser, { appuserKey: pairing.appuserKey.appuserKey });
  if (!appuser) return { status: 'invalid' };

  const session = await sessions.createSession({
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    userId: appuser.externalUserId,
  });

  pairing.sessionId = session.sessionId;
  pairing.deviceLabel = deviceLabelFrom(input.userAgent);
  await em.flush();

  return {
    device: {
      id: session.sessionId,
      label: pairing.deviceLabel,
      lastSeenAt: now,
      pairedAt: pairing.createdAt,
    },
    session,
    status: 'paired',
  };
}

/** The paired devices for `appuser`, newest first. A device whose session is gone is not listed. */
export async function listMobileDevices(
  appuser: Appuser,
  options: { em?: EntityManager; sessions?: MobileSessionPort } = {},
): Promise<MobileDevice[]> {
  const em = options.em ?? DI.em;
  const sessions = options.sessions ?? betterAuthMobileSessionPort;

  const pairings = await em.find(
    MobilePairing,
    { appuserKey: appuser, deletedAt: null, revokedAt: null, sessionId: { $ne: null } },
    { orderBy: { createdAt: 'desc' } },
  );
  const sessionIds = pairings.flatMap((pairing) => pairing.sessionId ? [pairing.sessionId] : []);
  if (sessionIds.length === 0) return [];

  const summaries = new Map(
    (await sessions.listSessions(sessionIds)).map((session) => [session.id, session]),
  );

  return pairings.flatMap((pairing) => {
    const session = pairing.sessionId ? summaries.get(pairing.sessionId) : undefined;
    if (!session) return [];
    return [{
      id: session.id,
      label: pairing.deviceLabel ?? defaultDeviceLabel(),
      lastSeenAt: session.updatedAt,
      pairedAt: session.createdAt,
    }];
  });
}

/**
 * Revoke a paired device: delete its better-auth session, which ends it on the phone's next
 * request, then mark the pairing revoked so the list stays honest even if the session row was
 * already gone.
 */
export async function revokeMobileDevice(
  appuser: Appuser,
  sessionId: string,
  options: { em?: EntityManager; sessions?: MobileSessionPort } = {},
): Promise<void> {
  const em = options.em ?? DI.em;
  const sessions = options.sessions ?? betterAuthMobileSessionPort;

  const pairing = await em.findOne(MobilePairing, {
    appuserKey: appuser,
    deletedAt: null,
    revokedAt: null,
    sessionId,
  });
  if (!pairing) throw new NotFoundError('Device not found');

  await sessions.deleteSession(sessionId);
  pairing.revokedAt = new Date();
  await em.flush();
}

/** A short, human label from the phone's user agent. */
export function deviceLabelFrom(userAgent: null | string | undefined): string {
  const label = userAgent?.trim();
  return label ? label.slice(0, 120) : defaultDeviceLabel();
}

function defaultDeviceLabel(): string {
  return 'WonderMoney Mobile';
}

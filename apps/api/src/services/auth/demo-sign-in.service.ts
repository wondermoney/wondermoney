import type { EntityManager } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import { isDemoSignInEnabled } from '@config/demo';
import { AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { TenantType } from '@entity/Tenant';
import {
  createDemoSession,
  deleteExpiredAuthSessions,
  findBetterAuthUser,
  type IssuedSession,
} from '@service/auth/better-auth';
import { demoSessionDeadline, isDemoAccountEmail } from '@service/auth/demo-session';
import { resolveDemoRefreshIdentity } from '@service/demo-data/demo-data-refresh-identity';

/**
 * One-click sign-in to the shared, read-only demo account (`POST /v1/auth/demo`).
 *
 * The request carries nothing: no email, no user id, no password. The account is resolved on the
 * server, and every one of these must hold before a session is created, or nobody is signed in:
 *
 * - the instance enabled it (`DEMO_SIGN_IN_ENABLED`);
 * - there is exactly one active demo `Appuser` (account type `demo`, the canonical demo address)
 *   and exactly one active demo household it owns;
 * - the demo user belongs to that household only, and nobody else belongs to it;
 * - the better-auth user behind it exists and carries the canonical demo address too, so a demo row
 *   whose `externalUserId` was pointed at somebody else's login signs in no one;
 * - that user has no TOTP: the demo must never be a way around a second factor.
 *
 * The session is created through better-auth's own adapter (`createDemoSession`), with no IP or user
 * agent stored (the demo's visitors are strangers to each other and could list the sessions), and
 * ends `DEMO_SESSION_TTL_MS` after it starts.
 */

export type DemoSignInResult =
  | { reason: DemoUnavailableReason; status: 'unavailable' }
  | { session: IssuedSession; status: 'signed-in' }
  | { status: 'disabled' };

export type DemoUnavailableReason =
  | 'ambiguous-demo-identity'
  | 'auth-user-mismatch'
  | 'demo-household-shared'
  | 'missing-auth-user'
  | 'missing-demo-appuser'
  | 'missing-demo-appuser-tenant-link'
  | 'missing-demo-tenant'
  | 'two-factor-enabled';

/** The better-auth operations the demo sign-in needs, injectable so tests need no auth server. */
export interface DemoSessionPort {
  createSession: (input: { expiresAt: Date; userId: string }) => Promise<IssuedSession>;
  deleteExpiredSessions: (userId: string) => Promise<void>;
  findUser: (userId: string) => Promise<null | { email: string; id: string; twoFactorEnabled: boolean | null }>;
}

// Looked up when called, not when this module loads, so a test double of better-auth that leaves
// these out still lets every route module load.
export const betterAuthDemoSessionPort: DemoSessionPort = {
  createSession: (input) => createDemoSession(input),
  deleteExpiredSessions: (userId) => deleteExpiredAuthSessions(userId),
  findUser: (userId) => findBetterAuthUser(userId),
};

export async function signInToDemo(
  options: { em?: EntityManager; enabled?: boolean; now?: Date; sessions?: DemoSessionPort } = {},
): Promise<DemoSignInResult> {
  if (!(options.enabled ?? isDemoSignInEnabled())) return { status: 'disabled' };

  const em = options.em ?? DI.em;
  const sessions = options.sessions ?? betterAuthDemoSessionPort;
  const now = options.now ?? new Date();

  let identity: Awaited<ReturnType<typeof resolveDemoRefreshIdentity>>;
  try {
    identity = await resolveDemoRefreshIdentity(em);
  } catch {
    // More than one demo user, household or link, or a household owned by someone else.
    return unavailable('ambiguous-demo-identity');
  }
  if (identity.status === 'missing') return unavailable(identity.reason);

  const { appuser, tenant } = identity;
  if (
    appuser.accountType !== AppuserAccountType.DEMO ||
    tenant.tenantType !== TenantType.DEMO ||
    !isDemoAccountEmail(appuser.emailAddress)
  ) {
    return unavailable('auth-user-mismatch');
  }

  const [appuserMemberships, householdMembers] = await Promise.all([
    em.count(AppuserTenant, { appuserKey: appuser, deletedAt: null, recordActive: true }),
    em.count(AppuserTenant, { deletedAt: null, recordActive: true, tenantKey: tenant }),
  ]);
  if (appuserMemberships !== 1 || householdMembers !== 1) return unavailable('demo-household-shared');

  const authUser = await sessions.findUser(appuser.externalUserId);
  if (!authUser) return unavailable('missing-auth-user');
  if (authUser.id !== appuser.externalUserId || !isDemoAccountEmail(authUser.email)) {
    return unavailable('auth-user-mismatch');
  }
  if (authUser.twoFactorEnabled) return unavailable('two-factor-enabled');

  // Expired demo sessions are only cleaned up when presented; one sign-in per visitor would
  // otherwise leave a row behind for every visit.
  await sessions.deleteExpiredSessions(authUser.id);
  const session = await sessions.createSession({ expiresAt: demoSessionDeadline(now), userId: authUser.id });
  return { session, status: 'signed-in' };
}

function unavailable(reason: DemoUnavailableReason): DemoSignInResult {
  return { reason, status: 'unavailable' };
}

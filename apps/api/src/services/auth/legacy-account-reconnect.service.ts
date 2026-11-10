import type { EntityManager } from '@mikro-orm/postgresql';

import { Appuser } from '@entity/Appuser';

/**
 * Accounts created before the move to better-auth (2026-10-01) still carry the old provider's user
 * id in `externalUserId`. No better-auth login has that id, so their owners could neither sign in
 * nor sign up again: the callback found the account by email and refused it as "registered with
 * another provider".
 *
 * A new login takes such an account over only when better-auth has verified its email (Google
 * does; an email signup must follow the verification link first) and the account has no working
 * login of its own. The update is compare-and-set on the old id, so of two logins racing for the
 * same account only the first gets it.
 */
export interface LegacyReconnectDeps {
  authUserExists: (userId: string) => Promise<boolean>;
}

export type LegacyReconnectResult = 'email-unverified' | 'has-login' | 'reconnected';

export async function reconnectLegacyAppuser(
  em: EntityManager,
  input: { appuser: Appuser; emailVerified: boolean; externalUserId: string },
  deps: LegacyReconnectDeps,
): Promise<LegacyReconnectResult> {
  const previousExternalUserId = input.appuser.externalUserId;
  if (await deps.authUserExists(previousExternalUserId)) return 'has-login';
  if (!input.emailVerified) return 'email-unverified';

  const updated = await em.nativeUpdate(
    Appuser,
    { appuserKey: input.appuser.appuserKey, externalUserId: previousExternalUserId },
    { externalUserId: input.externalUserId },
  );
  return updated === 1 ? 'reconnected' : 'has-login';
}

import type { EntityManager } from '@mikro-orm/postgresql';

import { Appuser, AppuserAccountType } from '@entity/Appuser';

/**
 * Set the instance-admin flag (`Appuser.accountType`) of the app user signed in as
 * `externalUserId` (the better-auth user id), from the identity provider's admin groups.
 *
 * Called on every OIDC sign-in while `OIDC_ADMIN_GROUPS` is set, so leaving the group revokes
 * admin at the next sign-in. Only an admin or regular account moves; the demo account never
 * does. Before the first `POST /v1/auth/callback` there is no app user yet: nothing is updated,
 * and `recordSignup` creates it with the flag better-auth kept (`oidcAdmin`).
 */
export async function syncInstanceAdmin(em: EntityManager, externalUserId: string, admin: boolean): Promise<void> {
  await em.nativeUpdate(
    Appuser,
    { accountType: { $in: [AppuserAccountType.ADMIN, AppuserAccountType.REGULAR] }, externalUserId },
    { accountType: admin ? AppuserAccountType.ADMIN : AppuserAccountType.REGULAR },
  );
}

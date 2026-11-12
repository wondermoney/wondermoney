import type { EntityManager } from '@mikro-orm/postgresql';

import { Appuser, AppuserAccountType } from '@entity/Appuser';

export type InstanceAdminChange = 'demo' | 'not_found' | 'unchanged' | 'updated';

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

/**
 * Grant or revoke instance admin for the app user with this email, by hand: the way to make
 * someone an admin without single sign-on (`database/scripts/instance-admin.ts`, run inside the
 * api container). Running a command on the server is already full control of the instance, so
 * this adds no new way in; an email in an environment variable would, to anyone who signed up
 * with that address first.
 *
 * With `OIDC_ADMIN_GROUPS` set, the next OIDC sign-in of that person sets the flag from their
 * groups again. The demo account never changes.
 */
export async function setInstanceAdminByEmail(em: EntityManager, email: string, admin: boolean): Promise<InstanceAdminChange> {
  const appuser = await em.getRepository(Appuser).getUserByEmail(email);
  if (!appuser) return 'not_found';
  if (appuser.accountType === AppuserAccountType.DEMO) return 'demo';
  const accountType = admin ? AppuserAccountType.ADMIN : AppuserAccountType.REGULAR;
  if (appuser.accountType === accountType) return 'unchanged';
  appuser.accountType = accountType;
  await em.flush();
  return 'updated';
}

/** The emails of every instance admin, for the script's `list`. */
export async function listInstanceAdminEmails(em: EntityManager): Promise<string[]> {
  const admins = await em.find(
    Appuser,
    { accountType: AppuserAccountType.ADMIN, deletedAt: undefined, recordActive: true },
    { fields: ['emailAddress'], orderBy: { emailAddress: 'asc' } },
  );
  return admins.map((appuser) => appuser.emailAddress);
}

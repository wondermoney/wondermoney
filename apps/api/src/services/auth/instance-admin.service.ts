import type { EntityManager } from '@mikro-orm/postgresql';

import { loadAuthConfiguration } from '@config/configuration';
import { Appuser, AppuserAccountType } from '@entity/Appuser';

export type InstanceAdminChange = 'demo' | 'not_found' | 'unchanged' | 'updated';

type Env = Readonly<Record<string, string | undefined>>;

/** What first sign-ups take turns on (`pg_advisory_xact_lock(hashtext(...))`). */
const FIRST_ACCOUNT_LOCK = 'wondermoney.first-account';

/**
 * Whether this instance is set up: an app user other than the demo account has ever existed,
 * deleted and deactivated ones included. The one rule behind both `setupRequired`
 * (instance-setup.ts) and the first-account admin grant (`claimFirstAccount`), so the setup page
 * shows exactly while the grant is open. The demo account never counts: seeding the demo before
 * setup neither hides setup nor takes the grant.
 *
 * Instance-wide by design and answers only a boolean, so it carries no tenant predicate. Runs in
 * `em`'s transaction when it has one.
 */
export async function isInstanceSetUp(em: EntityManager): Promise<boolean> {
  const [row] = await em.getConnection().execute<{ exists: boolean }[]>(
    'select exists(select 1 from appuser where account_type <> ?) as "exists"',
    [AppuserAccountType.DEMO],
    'all',
    em.getTransactionContext(),
  );
  return row?.exists === true;
}

/**
 * Whether the app user about to be created is the first on this instance, and so its admin: the
 * person who installed a server signs up first and can run it (`/admin/bank-sync`) without a
 * script. Call it inside the transaction that creates the app user. "First" is `isInstanceSetUp`
 * being false.
 *
 * Atomic: a sign-up that finds the instance not set up takes a transaction-scoped advisory lock
 * and looks again. Concurrent first sign-ups queue on the lock, and each one after the first wakes
 * up once the one ahead of it has committed (or rolled back), so its second look sees that row
 * under READ COMMITTED. Exactly one of them is first. A set-up instance answers from the first
 * look and never takes the lock.
 */
export async function claimFirstAccount(em: EntityManager): Promise<boolean> {
  if (await isInstanceSetUp(em)) return false;
  await em.getConnection().execute('select pg_advisory_xact_lock(hashtext(?))', [FIRST_ACCOUNT_LOCK], 'all', em.getTransactionContext());
  return !(await isInstanceSetUp(em));
}

/**
 * Whether the first account on this instance becomes its admin (`GET /v1/instance`
 * `firstAccountAdmin`): true unless single sign-on's admin groups decide (`OIDC_ADMIN_GROUPS`).
 */
export function firstAccountIsAdmin(env: Env = process.env): boolean {
  return (loadAuthConfiguration(env).oidc?.adminGroups.length ?? 0) === 0;
}

/**
 * The admin flag a new sign-up carries from the identity provider: whether it is in one of the
 * admin groups when the groups decide (single sign-on with `OIDC_ADMIN_GROUPS`), otherwise null.
 *
 * While the groups decide they decide for everyone, a password or Google sign-up included, and the
 * first-account rule does not apply: an empty server's first account outside those groups is a
 * regular account.
 */
export function signupAdminFromGroups(oidcAdmin: boolean | null | undefined, env: Env = process.env): boolean | null {
  return firstAccountIsAdmin(env) ? null : oidcAdmin === true;
}

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

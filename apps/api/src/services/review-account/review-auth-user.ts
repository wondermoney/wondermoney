import { randomBytes, randomUUID } from 'node:crypto';

import { hashPassword } from 'better-auth/crypto';

/**
 * The store-review account's better-auth user, written straight to better-auth's tables.
 *
 * Not through `signUpEmail`: the hosted server runs with sign-up rules (and may run with sign-up
 * closed) that would refuse a seeder, and a sign-up would mail a verification link nobody reads.
 * The password is hashed with better-auth's own hasher, the one `emailAndPassword` uses for every
 * new password, and only the hash is stored.
 */

/** One statement against the database that holds the `better_auth` schema, with `$1`-style parameters. */
export type AuthSqlQuery = <R extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;

/** Runs `run` in one transaction on the better-auth database. */
export interface AuthSqlStore {
  transaction<T>(run: (query: AuthSqlQuery) => Promise<T>): Promise<T>;
}

export interface ReviewAuthUser {
  email: string;
  /** Whether the user has an email-and-password login. */
  hasPassword: boolean;
  id: string;
}

export interface ReviewAuthUserPort {
  /**
   * Create the user with this id, or update it: its name, a verified address and two-factor off
   * (its TOTP secret and backup codes are deleted), since a reviewer can receive no code. With a
   * `password`, set it as the email-and-password login; on an existing user that also ends every
   * session and OAuth grant made with the old one. Its passkeys and social logins stay.
   */
  ensureUser(input: { email: string; id: string; name: string; password?: string }): Promise<{ created: boolean }>;
  findUserByEmail(email: string): Promise<null | ReviewAuthUser>;
  findUserById(id: string): Promise<null | ReviewAuthUser>;
}

/** A strong random password: 24 random bytes, 32 characters of base64url. */
export function generateReviewPassword(): string {
  return randomBytes(24).toString('base64url');
}

const SCHEMA = '"better_auth"';

const SELECT_USER = `select u.id, u.email,
         exists(select 1 from ${SCHEMA}."account" a
                 where a."userId" = u.id and a."providerId" = 'credential' and a.password is not null) as "hasPassword"
    from ${SCHEMA}."user" u`;

export function createReviewAuthUserPort(
  store: AuthSqlStore,
  hooks: {
    /** Take back every OAuth grant of `userId`, on the transaction that changes the password. */
    revokeGrants?: (query: AuthSqlQuery, userId: string) => Promise<void>;
  } = {},
): ReviewAuthUserPort {
  const findOne = async (where: string, value: string): Promise<null | ReviewAuthUser> =>
    store.transaction(async (query) => {
      const rows = await query<ReviewAuthUser>(`${SELECT_USER} where ${where}`, [value]);
      if (rows.length > 1) throw new Error(`Found ${rows.length} better-auth users for one review address; expected one.`);
      const row = rows[0];
      return row ? { email: row.email, hasPassword: row.hasPassword, id: row.id } : null;
    });

  return {
    async ensureUser({ email, id, name, password }) {
      const hash = password === undefined ? undefined : await hashPassword(password);
      const created = await store.transaction(async (query) => {
        const existing = await query<{ id: string }>(`select id from ${SCHEMA}."user" where id = $1 for update`, [id]);
        const isNew = existing.length === 0;
        if (isNew) {
          if (hash === undefined) throw new Error('A new review account needs a password.');
          await query(
            `insert into ${SCHEMA}."user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt")
             values ($1, $2, $3, true, false, now(), now())`,
            [id, name, email],
          );
        } else {
          await query(
            `update ${SCHEMA}."user" set name = $2, "emailVerified" = true, "twoFactorEnabled" = false, "updatedAt" = now() where id = $1`,
            [id, name],
          );
        }
        await query(`delete from ${SCHEMA}."twoFactor" where "userId" = $1`, [id]);

        if (hash !== undefined) {
          const updated = await query(
            `update ${SCHEMA}."account" set password = $2, "updatedAt" = now()
              where "userId" = $1 and "providerId" = 'credential' returning id`,
            [id, hash],
          );
          if (updated.length === 0) {
            await query(
              `insert into ${SCHEMA}."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
               values ($1, $2, 'credential', $3, $4, now(), now())`,
              [randomUUID(), id, id, hash],
            );
          }
          // A new password ends what the old one opened, as a password reset in the app does, in
          // this transaction: the password is saved only with the rest gone.
          if (!isNew) {
            await query(`delete from ${SCHEMA}."session" where "userId" = $1`, [id]);
            await hooks.revokeGrants?.(query, id);
          }
        }
        return isNew;
      });
      return { created };
    },
    findUserByEmail: (email) => findOne('lower(u.email) = lower($1)', email),
    findUserById: (id) => findOne('u.id = $1', id),
  };
}

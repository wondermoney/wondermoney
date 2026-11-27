import type { EntityManager } from '@mikro-orm/postgresql';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { twoFactor } from 'better-auth/plugins';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { ReferenceDataSeeder } from '@app/database/seeders/ReferenceDataSeeder';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Tenant, TenantType } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { isDemoRequest } from '@middleware/demo';
import { executeAiTool } from '@service/ai-tools/ai-tool-types';
import { AI_TOOL_DEFINITIONS } from '@service/ai-tools/ai-tools.service';
import { isDemoAccountEmail, isExpiredDemoSession } from '@service/auth/demo-session';
import { resolveDemoRefreshIdentity } from '@service/demo-data/demo-data-refresh-identity';
import { type DemoAuthUserPort, seedDemoHousehold } from '@service/demo-data/demo-household-seed.service';
import {
  reviewPersona,
  ReviewSeedRefusedError,
  seedReviewAccount,
} from '@service/review-account/review-account-seed.service';
import {
  type AuthSqlQuery,
  type AuthSqlStore,
  createReviewAuthUserPort,
} from '@service/review-account/review-auth-user';

/*
 * The review seeder on a database shaped like the hosted one: migrated (so better-auth's tables are
 * there), reference data loaded, the public demo and a real household beside it. It runs the real
 * household upserts, the demo's real refresh and the real better-auth writes, on PGlite; a sign-in
 * goes through Better Auth's own email-and-password route over the rows the seeder wrote.
 */

const REVIEW_EMAIL = 'review@example.com';
const FIRST_DAY = new Date('2026-11-12T00:00:00.000Z');
const LATER_DAY = new Date('2026-11-20T12:00:00.000Z');

const db = useTestDatabase({ schema: 'migrations' });

afterEach(() => {
  vi.useRealTimers();
});

type Row = Record<string, unknown>;

function demoAuth(): DemoAuthUserPort {
  const users = new Map<string, string>();
  return {
    ensureUser: ({ email }) => {
      const existing = users.get(email);
      if (existing) return Promise.resolve({ created: false, id: existing });
      const id = `demo-auth-${users.size + 1}`;
      users.set(email, id);
      return Promise.resolve({ created: true, id });
    },
  };
}

/** better-auth's tables, through the test database's one connection, in a transaction like the pool's. */
function pgliteAuthStore(): AuthSqlStore {
  return {
    async transaction(run) {
      const connection = db.em().getConnection();
      const query: AuthSqlQuery = async <R extends object>(sql: string, params: unknown[] = []) => {
        const ordered: unknown[] = [];
        const text = sql.replace(/\$(\d+)/gu, (_match, index: string) => {
          ordered.push(params[Number(index) - 1]);
          return '?';
        });
        return connection.execute<R[]>(text, ordered);
      };
      await connection.execute('begin');
      try {
        const result = await run(query);
        await connection.execute('commit');
        return result;
      } catch (error) {
        await connection.execute('rollback');
        throw error;
      }
    },
  };
}

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return db.em().getConnection().execute<Row[]>(sql, params);
}

/** Sign in with an email and a password through Better Auth, over the better-auth rows in the database. */
async function signIn(email: string, password: string) {
  const memory: Record<string, Row[]> = {
    account: await rows('select * from better_auth."account"'),
    session: [],
    twoFactor: await rows('select * from better_auth."twoFactor"'),
    user: await rows('select * from better_auth."user"'),
    verification: [],
  };
  const apiURL = 'https://api.money.example.test';
  const auth = betterAuth({
    baseURL: apiURL,
    database: memoryAdapter(memory),
    emailAndPassword: { enabled: true },
    plugins: [twoFactor()],
    rateLimit: { enabled: false },
    secret: 'review-seed-test-secret-at-least-thirty-two-chars',
  });
  const response = await auth.handler(
    new Request(`${apiURL}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json', origin: apiURL },
      method: 'POST',
    }),
  );
  const body = (await response.json()) as Row;
  return { body, status: response.status };
}

/**
 * Every row that belongs to a household other than `reviewTenantKey`, or to another person: each
 * public table with a tenant key, every other app user and every other better-auth row. A row
 * written by the seeder (even with the same values) moves its `updated_at`.
 */
async function everythingElse(reviewTenantKey: number, reviewAppuserKey: number, reviewAuthId: string) {
  const tables = await rows(
    `select table_name as name from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_key' order by table_name`,
  );
  const snapshot: Record<string, string> = {};
  for (const { name } of tables) {
    const [result] = await rows(
      `select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h
         from public."${String(name)}" t where t.tenant_key is not null and t.tenant_key <> ?`,
      [reviewTenantKey],
    );
    snapshot[String(name)] = `${String(result?.['n'])}:${String(result?.['h'])}`;
  }
  const others = async (label: string, sql: string, param: unknown) => {
    const [result] = await rows(sql, [param]);
    snapshot[label] = `${String(result?.['n'])}:${String(result?.['h'])}`;
  };
  await others(
    'appuser',
    `select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from public.appuser t where t.appuser_key <> ?`,
    reviewAppuserKey,
  );
  for (const table of ['user', 'account', 'session', 'twoFactor']) {
    const column = table === 'user' ? 'id' : '"userId"';
    await others(
      `better_auth.${table}`,
      `select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from better_auth."${table}" t where t.${column} <> ?`,
      reviewAuthId,
    );
  }
  return snapshot;
}

async function reviewAppuser(em: EntityManager): Promise<Appuser> {
  return em.findOneOrFail(Appuser, { emailAddress: REVIEW_EMAIL }, { filters: false });
}

describe('seeding the store-review account', () => {
  // Loading the reference data and the demo takes a while, so one test walks the whole story.
  it(
    'creates a regular account beside the demo and a real household, signs in by password, and refreshes on a rerun without touching anyone else',
    async () => {
      await new ReferenceDataSeeder().run(db.em(), {});
      await db.em().flush();
      const regular = await seedHousehold(db.em());
      await seedDemoHousehold({ asOfDate: FIRST_DAY, auth: demoAuth(), em: db.em() });
      const auth = createReviewAuthUserPort(pgliteAuthStore());

      // First run: a new account with a generated password, returned once.
      const first = await seedReviewAccount({ asOfDate: FIRST_DAY, auth, em: db.em(), email: REVIEW_EMAIL });
      expect(first.authUserCreated).toBe(true);
      expect(first.password).toMatch(/^[\w-]{32}$/u);
      const password = first.password ?? '';

      const em = db.em();
      const appuser = await reviewAppuser(em);
      const tenant = await em.findOneOrFail(Tenant, { tenantKey: first.tenantKey }, { filters: false });
      expect(appuser.appuserKey).toBe(first.appuserKey);
      expect(appuser.accountType).toBe(AppuserAccountType.REGULAR);
      expect(tenant).toMatchObject({ name: reviewPersona.householdName, tenantType: TenantType.REGULAR });
      expect(tenant.ownerAppuserKey.appuserKey).toBe(appuser.appuserKey);
      const members = await em.find(AppuserTenant, { tenantKey: tenant }, { filters: false });
      expect(members.map((member) => [member.appuserKey.appuserKey, member.role])).toEqual([
        [appuser.appuserKey, HouseholdRole.OWNER],
      ]);

      // Signs in with the address and the password, verified, with no second factor asked for.
      const [authUser] = await rows('select * from better_auth."user" where id = ?', [appuser.externalUserId]);
      expect(authUser).toMatchObject({ email: REVIEW_EMAIL, emailVerified: true, twoFactorEnabled: false });
      const signedIn = await signIn(REVIEW_EMAIL, password);
      expect(signedIn.status).toBe(200);
      expect(signedIn.body['twoFactorRedirect']).toBeUndefined();
      expect(signedIn.body['token']).toEqual(expect.any(String));
      expect((await signIn(REVIEW_EMAIL, 'not-the-password')).status).toBe(401);

      // The password is stored only as a hash: no better-auth row holds it.
      for (const table of ['user', 'account', 'session', 'twoFactor', 'verification']) {
        expect(JSON.stringify(await rows(`select * from better_auth."${table}"`))).not.toContain(password);
      }

      // Not the demo account: none of the demo's guards or jobs apply to it.
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      expect(isDemoAccountEmail(REVIEW_EMAIL)).toBe(false);
      expect(isExpiredDemoSession({ createdAt: threeHoursAgo, email: REVIEW_EMAIL })).toBe(false);
      expect(isDemoRequest({ tenant, user: appuser } as unknown as Request)).toBe(false);
      const demoIdentity = await resolveDemoRefreshIdentity(db.em());
      expect(demoIdentity.status === 'found' && demoIdentity.appuser.emailAddress).toBe(demoPersona.email);

      // A reviewer turned two-factor on: a rerun turns it off again.
      await rows('update better_auth."user" set "twoFactorEnabled" = true where id = ?', [appuser.externalUserId]);
      await rows(
        `insert into better_auth."twoFactor" (id, secret, "backupCodes", "userId", verified) values ('factor-1', 'secret', 'codes', ?, true)`,
        [appuser.externalUserId],
      );
      await rows(
        `insert into better_auth."session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
         values ('session-1', now() + interval '1 day', 'token-1', now(), now(), ?)`,
        [appuser.externalUserId],
      );

      // A reviewer deleted a sample account, a portfolio and a loan: the rerun brings them back.
      for (const table of ['account', 'portfolio', 'loan']) {
        const owner = { account: 'account_owner_appuser_key', loan: 'owner_appuser_key', portfolio: 'portfolio_owner_appuser_key' }[table];
        await rows(
          `update public."${table}" set deleted_at = now() where ${table}_key = (select min(${table}_key) from public."${table}" where tenant_key = ? and ${owner} = ?)`,
          [first.tenantKey, first.appuserKey],
        );
      }

      // A rerun on a later day, with no date given: today's sample data, the same password, and
      // nothing else in the database changed.
      const before = await everythingElse(first.tenantKey, first.appuserKey, appuser.externalUserId);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(LATER_DAY);
      const second = await seedReviewAccount({ auth, em: db.em(), email: REVIEW_EMAIL });
      expect(second).toMatchObject({ appuserKey: first.appuserKey, authUserCreated: false, tenantKey: first.tenantKey });
      expect(second.password).toBeUndefined();
      expect(await everythingElse(first.tenantKey, first.appuserKey, appuser.externalUserId)).toEqual(before);

      const newest = await db
        .em()
        .findOneOrFail(Transaction, { tenantKey: { tenantKey: first.tenantKey } }, { filters: false, orderBy: { transactionDate: 'desc' } });
      expect(newest.transactionDate?.toISOString().slice(0, 10)).toBe('2026-11-20');
      for (const table of ['account', 'portfolio', 'loan']) {
        expect(await rows(`select 1 from public."${table}" where tenant_key = ? and deleted_at is not null`, [first.tenantKey])).toEqual([]);
      }
      expect(await rows('select 1 from better_auth."twoFactor" where "userId" = ?', [appuser.externalUserId])).toEqual([]);
      const rerunSignIn = await signIn(REVIEW_EMAIL, password);
      expect(rerunSignIn.status).toBe(200);
      expect(rerunSignIn.body['twoFactorRedirect']).toBeUndefined();
      // Keeping the password keeps the reviewer's session.
      expect(await rows('select 1 from better_auth."session" where "userId" = ?', [appuser.externalUserId])).toHaveLength(1);

      // Every MCP read tool has something to show the reviewer.
      DI.em = db.em();
      const context = { appuserKey: first.appuserKey, currency: 'EUR', tenantKey: first.tenantKey };
      const empty: string[] = [];
      for (const definition of AI_TOOL_DEFINITIONS) {
        const result = await executeAiTool(definition, definition.inputSchema.parse({}), context);
        if (!result.dataUsed.recordCount) empty.push(definition.name);
      }
      expect(empty).toEqual([]);

      // --reset-password: a new password, the old one and its sessions gone.
      const reset = await seedReviewAccount({ auth, em: db.em(), email: REVIEW_EMAIL, resetPassword: true });
      expect(reset.password).toMatch(/^[\w-]{32}$/u);
      expect(reset.password).not.toBe(password);
      expect((await signIn(REVIEW_EMAIL, password)).status).toBe(401);
      expect((await signIn(REVIEW_EMAIL, reset.password ?? '')).status).toBe(200);
      expect(await rows('select 1 from better_auth."session" where "userId" = ?', [appuser.externalUserId])).toEqual([]);

      // Refusals change nothing.
      const settled = await everythingElse(-1, -1, '');
      await expect(seedReviewAccount({ auth, em: db.em(), email: '' })).rejects.toBeInstanceOf(ReviewSeedRefusedError);
      await expect(seedReviewAccount({ auth, em: db.em(), email: demoPersona.email })).rejects.toBeInstanceOf(
        ReviewSeedRefusedError,
      );
      // A real person's address.
      await expect(
        seedReviewAccount({ auth, em: db.em(), email: regular.appuser.emailAddress }),
      ).rejects.toBeInstanceOf(ReviewSeedRefusedError);
      // An address somebody signs in with, with no account behind it yet.
      await rows(
        `insert into better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ('someone-else', 'Someone', 'someone@example.com', false, now(), now())`,
      );
      const withSomeone = await everythingElse(-1, -1, '');
      await expect(
        seedReviewAccount({ auth, em: db.em(), email: 'someone@example.com' }),
      ).rejects.toBeInstanceOf(ReviewSeedRefusedError);
      expect(await everythingElse(-1, -1, '')).toEqual(withSomeone);
      await rows(`delete from better_auth."user" where id = 'someone-else'`);
      expect(await everythingElse(-1, -1, '')).toEqual(settled);

      // Somebody else joined the review household: refused, so the seeder never writes over them.
      const join = db.em();
      join.create(
        AppuserTenant,
        {
          appuserKey: await join.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey }),
          recordActive: true,
          role: HouseholdRole.MEMBER,
          tenantKey: await join.findOneOrFail(Tenant, { tenantKey: first.tenantKey }, { filters: false }),
        },
        { partial: true },
      );
      await join.flush();
      await expect(seedReviewAccount({ auth, em: db.em(), email: REVIEW_EMAIL })).rejects.toBeInstanceOf(
        ReviewSeedRefusedError,
      );
    },
    240_000,
  );
});

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { setupRequiredFromDatabase } from '@service/auth/instance-setup';
import { recordSignup } from '@service/auth/signup-record.service';

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the sign-ups to block');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Whoever installs a server signs up first and should be able to run it: the first account on an
 * empty instance is its admin, and only that one. With the identity provider's admin groups set
 * (`admin` true or false), the groups decide instead. "Empty" is the one rule `setupRequired` uses
 * too: no app user other than the demo account has ever existed.
 */
describe('the first account on an instance', () => {
  // The real server when TEST_POSTGRES_URL is set (concurrent sessions on a pool), else PGlite.
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  const freshInstance = async () => {
    const em = db.em();
    em.create(Currency, { code: 'EUR', num: '978' }, { partial: true });
    await em.flush();
  };

  const signUp = (name: string, admin?: boolean | null) =>
    recordSignup({ admin, email: `${name}@example.com`, externalUserId: randomUUID(), method: 'email' });

  const accountTypes = async () =>
    (await db.em().find(Appuser, {}, { orderBy: { appuserKey: 'asc' } })).map((appuser) => appuser.accountType);

  it('becomes the instance admin, and every later account is a regular one', async () => {
    await freshInstance();

    const first = await signUp('ada');
    const second = await signUp('alan');

    expect(first.appuser.accountType).toBe(AppuserAccountType.ADMIN);
    expect(second.appuser.accountType).toBe(AppuserAccountType.REGULAR);
    expect(await accountTypes()).toEqual([AppuserAccountType.ADMIN, AppuserAccountType.REGULAR]);
  });

  it('is a regular account on a server whose only account was deleted, and setup stays done', async () => {
    await freshInstance();
    const deleted = (await signUp('ada')).appuser;
    // Deleting an account soft-deletes its app user (its better-auth user goes for good).
    await db.em().nativeUpdate(Appuser, { appuserKey: deleted.appuserKey }, { deletedAt: new Date(), recordActive: false });

    // A fresh check, as after an API restart.
    expect(await setupRequiredFromDatabase(() => db.em())()).toBe(false);
    expect((await signUp('grace')).appuser.accountType).toBe(AppuserAccountType.REGULAR);
  });

  it('leaves setup open, and the admin grant with it, while only the demo account exists', async () => {
    await freshInstance();
    const demo = (await signUp('demo')).appuser;
    await db.em().nativeUpdate(Appuser, { appuserKey: demo.appuserKey }, { accountType: AppuserAccountType.DEMO });
    const isSetupRequired = setupRequiredFromDatabase(() => db.em());

    expect(await isSetupRequired()).toBe(true);
    expect((await signUp('grace')).appuser.accountType).toBe(AppuserAccountType.ADMIN);
    expect(await isSetupRequired()).toBe(false);
  });

  it("follows the identity provider's admin groups when they decide, on an empty server too", async () => {
    await freshInstance();

    const outsideTheGroups = await signUp('eve', false);
    const inTheGroups = await signUp('grace', true);

    expect(outsideTheGroups.appuser.accountType).toBe(AppuserAccountType.REGULAR);
    expect(inTheGroups.appuser.accountType).toBe(AppuserAccountType.ADMIN);
  });

  it.runIf(process.env['TEST_POSTGRES_URL'])('goes to exactly one of several sign-ups made at the same moment', async () => {
    await freshInstance();
    const names = ['ada', 'alan', 'grace', 'edsger', 'barbara'];

    // Hold every sign-up at the same point: a SHARE lock lets them all read the empty table but
    // blocks each one's insert, so none can see another's account until all of them are waiting.
    const gate = db.em();
    await gate.begin();
    const gateSql = (sql: string) => gate.getConnection().execute(sql, [], 'all', gate.getTransactionContext());
    await gateSql('lock table appuser in share mode');
    const signUps = Promise.all(names.map((name) => signUp(name)));
    await waitFor(async () => {
      const [row] = await db.em().getConnection().execute<{ waiting: number }[]>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      );
      return row?.waiting === names.length;
    });
    await gate.commit();

    const outcomes = await signUps;

    expect(outcomes.every(({ created }) => created)).toBe(true);
    const types = await accountTypes();
    expect(types).toHaveLength(names.length);
    expect(types.filter((type) => type === AppuserAccountType.ADMIN)).toHaveLength(1);
  });
});

import { LockMode } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 5).toString('base64');
});

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser } from '@entity/Appuser';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';

import { generateEnableBankingKeyPair } from '../enable-banking-certificate';
import { EnableBankingCredentialService } from '../enable-banking-credential.service';

const APPLICATION_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const PASTED_APPLICATION_ID = '9b2c4d6e-1f3a-4b5c-8d7e-0a1b2c3d4e5f';
/** Long enough for a write that did not wait for the lock to have finished. */
const BLOCKED_FOR_MS = 300;

/*
 * Every write to a person's Enable Banking credentials (create, activate, paste, remove) locks
 * their `appuser` row first, so a paste and an activation run one after the other and can never
 * leave two active credentials. Needs real Postgres sessions.
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('Enable Banking credential writes for one person', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  const serviceOn = () => new EnableBankingCredentialService(db.orm.em.fork());

  /** Holds the person's row lock in another session until `release` is called. */
  async function holdLock(appuserKey: number) {
    const holder = db.orm.em.fork();
    await holder.begin();
    await holder.findOneOrFail(Appuser, { appuserKey }, { fields: ['appuserKey'], lockMode: LockMode.PESSIMISTIC_WRITE });
    return { release: () => holder.commit() };
  }

  const settledWithin = async (promise: Promise<unknown>, ms: number) => {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, ms));
    return settled;
  };

  const activeRowsOf = (appuserKey: number) => db.orm.em.fork().find(EnableBankingCredential, { appuserKey: { appuserKey }, deletedAt: null, status: EnableBankingCredentialStatus.ACTIVE });

  it('waits for the lock in each of create, activate, paste and remove', async () => {
    const household = await seedHousehold(db.em());
    const { appuserKey } = household.appuser;
    await serviceOn().createPendingCredential({ appuser: household.appuser });
    const pending = await serviceOn().getLivePendingCredential(appuserKey);
    if (!pending) throw new Error('no pending credential');
    const pasted = await generateEnableBankingKeyPair();

    const writes: Record<string, () => Promise<unknown>> = {
      activate: () => serviceOn().activatePendingCredential(pending, APPLICATION_ID),
      create: () => serviceOn().createPendingCredential({ appuser: household.appuser }),
      paste: () => serviceOn().saveValidatedCredential({ applicationId: PASTED_APPLICATION_ID, appuser: household.appuser, privateKeyPem: pasted.privateKeyPem }),
      remove: () => serviceOn().deleteForAppuser(appuserKey),
    };
    for (const [name, write] of Object.entries(writes)) {
      const lock = await holdLock(appuserKey);
      const running = write();
      expect(await settledWithin(running, BLOCKED_FOR_MS), `${name} ran while the lock was held`).toBe(false);
      await lock.release();
      await running.catch(() => undefined);
    }
  });

  it('leaves one active credential when a paste and an activation arrive together', async () => {
    const household = await seedHousehold(db.em());
    const { appuserKey } = household.appuser;
    await serviceOn().createPendingCredential({ appuser: household.appuser });
    const pending = await serviceOn().getLivePendingCredential(appuserKey);
    if (!pending) throw new Error('no pending credential');
    const pasted = await generateEnableBankingKeyPair();

    // Both queue behind one lock, then run in turn.
    const lock = await holdLock(appuserKey);
    const both = Promise.allSettled([
      serviceOn().activatePendingCredential(pending, APPLICATION_ID),
      serviceOn().saveValidatedCredential({ applicationId: PASTED_APPLICATION_ID, appuser: household.appuser, privateKeyPem: pasted.privateKeyPem }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await lock.release();
    await both;

    expect(await activeRowsOf(appuserKey)).toHaveLength(1);
  });
});

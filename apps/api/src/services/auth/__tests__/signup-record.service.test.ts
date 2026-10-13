import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  transactional: vi.fn(),
}));

vi.mock('@app/database/di', () => ({
  DI: { em: { transactional: mocked.transactional } },
}));

import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { Appuser, SupportedLanguages } from '@entity/Appuser';

import { AppuserRepository } from '../../../database/repositories/AppuserRepository';
import { recordSignup } from '../signup-record.service';

beforeEach(() => {
  mocked.transactional.mockReset();
});

const signupInput = {
  email: 'person@example.com',
  externalUserId: 'd429ca40-d20c-4c37-bfbd-f1dbaeced27a',
  firstName: 'Person',
  language: SupportedLanguages.EN,
  method: 'email',
};

/**
 * An in-memory stand-in for the database: committed appusers keyed by external id, plus the
 * analytics rows that committed with them. A flush that finds the appuser already committed
 * fails with the unique-violation code, like Postgres would.
 */
function fakeDatabase() {
  const appusers = new Map<string, Appuser>();
  const outbox: AnalyticsOutbox[] = [];
  let nextKey = 40;
  let readGate: Promise<void> = Promise.resolve();
  const holdInitialReads = (readers: number) => {
    let release: () => void = () => undefined;
    readGate = new Promise<void>((resolve) => { release = resolve; });
    let waiting = 0;
    return () => {
      waiting += 1;
      if (waiting === readers) release();
    };
  };
  let onInitialRead: () => void = () => undefined;

  mocked.transactional.mockImplementation(async (callback: (em: unknown) => Promise<unknown>) => {
    const staged: object[] = [];
    let created: Appuser | undefined;
    const tx = {
      flush: vi.fn(() => {
        if (created && appusers.has(created.externalUserId)) {
          return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
        }
        if (created) appusers.set(created.externalUserId, created);
        outbox.push(...staged.filter((row): row is AnalyticsOutbox => row instanceof AnalyticsOutbox));
        staged.length = 0;
        return Promise.resolve();
      }),
      getRepository: vi.fn(() => ({
        createUser: vi.fn((input: { email: string; externalUserId: string; language: SupportedLanguages }) => {
          nextKey += 1;
          created = Object.assign(new Appuser(), { appuserKey: nextKey, emailAddress: input.email, externalUserId: input.externalUserId, language: input.language });
          return Promise.resolve(created);
        }),
        getUserByExternalId: vi.fn(async (externalUserId: string) => {
          const committed = appusers.get(externalUserId);
          if (committed) return committed;
          onInitialRead();
          await readGate;
          return appusers.get(externalUserId) ?? null;
        }),
      })),
      persist: vi.fn((entity: object) => {
        staged.push(entity);
      }),
    };
    return callback(tx);
  });

  return {
    appusers,
    outbox,
    raceInitialReads(readers: number) {
      onInitialRead = holdInitialReads(readers);
    },
  };
}

describe('AppuserRepository createUser baseline', () => {
  it('normalizes email and leaves marketing opt-in unset when receiveUpdates is false', async () => {
    // Given: the current repository dependencies and an explicit opt-out
    const currency = { code: 'EUR', currencyKey: 1 };
    const em = {
      findOne: vi.fn().mockResolvedValue(null),
      findOneOrFail: vi.fn().mockResolvedValue(currency),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn(),
    };
    em.persist.mockReturnValue(em);
    const repository: AppuserRepository = Reflect.construct(AppuserRepository, [em, Appuser]);

    // When: the repository creates the user
    const appuser = await repository.createUser({
      email: '  Person@Example.COM ',
      externalUserId: 'd429ca40-d20c-4c37-bfbd-f1dbaeced27a',
      receiveUpdates: false,
    });

    // Then: its existing normalization/default behavior is preserved
    expect(appuser).toMatchObject({
      currencyKey: currency,
      emailAddress: 'person@example.com',
      externalUserId: 'd429ca40-d20c-4c37-bfbd-f1dbaeced27a',
      firstName: 'person',
    });
    expect(appuser.marketingOptIn).toBeUndefined();
    expect(em.flush).toHaveBeenCalledOnce();
  });
});

describe('recordSignup', () => {
  it('creates the appuser and one signup analytics event', async () => {
    const db = fakeDatabase();

    const result = await recordSignup(signupInput);

    expect(result.created).toBe(true);
    expect(db.appusers.get(signupInput.externalUserId)).toBe(result.appuser);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({
      distinctId: signupInput.externalUserId,
      eventId: `signup.v1:${signupInput.externalUserId}`,
      eventName: 'signup',
      properties: { appuser_key: String(result.appuser.appuserKey), locale: 'EN', method: 'email' },
    });
  });

  it('keeps email and names out of the analytics event', async () => {
    const db = fakeDatabase();

    await recordSignup(signupInput);

    expect(JSON.stringify(db.outbox[0]?.properties)).not.toContain('person@example.com');
    expect(JSON.stringify(db.outbox[0]?.properties)).not.toContain('Person');
  });

  it('replays an existing signup without creating anything', async () => {
    const db = fakeDatabase();
    const first = await recordSignup(signupInput);

    const replay = await recordSignup(signupInput);

    expect(replay).toEqual({ appuser: first.appuser, created: false });
    expect(db.appusers).toHaveLength(1);
    expect(db.outbox).toHaveLength(1);
  });

  it('fulfils two simultaneous callbacks with exactly one created appuser', async () => {
    const db = fakeDatabase();
    db.raceInitialReads(2);

    const outcomes = await Promise.all([recordSignup(signupInput), recordSignup(signupInput)]);

    expect(outcomes.map(({ created }) => created).sort()).toEqual([false, true]);
    expect(outcomes[0].appuser).toBe(outcomes[1].appuser);
    expect(db.appusers).toHaveLength(1);
    expect(db.outbox).toHaveLength(1);
  });

  it('rejects a non-UUID external identity before opening a transaction', async () => {
    fakeDatabase();

    await expect(recordSignup({ ...signupInput, externalUserId: 'person+unsafe@example.com' })).rejects.toThrow();
    expect(mocked.transactional).not.toHaveBeenCalled();
  });

  it('propagates an error that is not a duplicate signup', async () => {
    mocked.transactional.mockRejectedValue(new Error('connection lost'));

    await expect(recordSignup(signupInput)).rejects.toThrow('connection lost');
  });
});

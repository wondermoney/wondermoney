import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { MobilePairing } from '@entity/MobilePairing';
import {
  buildPairingUrl,
  claimPairingCode,
  createPairingCode,
  hashPairingCode,
  listMobileDevices,
  type MobileSessionPort,
  PAIRING_CODE_TTL_MS,
  revokeMobileDevice,
} from '@service/auth/mobile-pairing.service';
import { NotFoundError } from '@utils/errors';

/*
 * A pairing code is a credential: it must be stored hashed, expire, work once, and the device
 * it creates must be revocable. These run against real Postgres because the claim is a
 * conditional UPDATE and its correctness is what single use means.
 */
describe('mobile pairing', () => {
  const db = useTestDatabase();

  const sessions = (): MobileSessionPort & { created: string[]; deleted: string[]; } => {
    const created: string[] = [];
    const deleted: string[] = [];
    const rows = new Map<string, { createdAt: Date; expiresAt: Date; id: string; ipAddress: null | string; updatedAt: Date; userAgent: null | string }>();
    return {
      created,
      createSession: (input) => {
        const id = `session-${created.length + 1}`;
        created.push(id);
        rows.set(id, {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          expiresAt: new Date('2026-01-08T00:00:00Z'),
          id,
          ipAddress: input.ipAddress ?? null,
          updatedAt: new Date('2026-01-02T00:00:00Z'),
          userAgent: input.userAgent ?? null,
        });
        return Promise.resolve({
          cookieName: 'better-auth.session_token',
          cookieValue: `signed-${id}`,
          expiresAt: new Date('2026-01-08T00:00:00Z'),
          sessionId: id,
          token: `token-${id}`,
        });
      },
      deleted,
      deleteSession: (id) => {
        deleted.push(id);
        rows.delete(id);
        return Promise.resolve();
      },
      listSessions: (ids) => Promise.resolve(ids.flatMap((id) => rows.get(id) ?? [])),
    };
  };

  it('stores only the hash of the code and expires it two minutes after creation', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const now = new Date('2026-05-01T10:00:00Z');

    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em, now });

    const row = await em.findOneOrFail(MobilePairing, { appuserKey: appuser });
    expect(row.codeHash).toBe(hashPairingCode(created.code));
    expect(row.codeHash).not.toBe(created.code);
    expect(row.expiresAt.getTime()).toBe(now.getTime() + PAIRING_CODE_TTL_MS);
    expect(created.url).toBe(buildPairingUrl('https://api.example.test', created.code));
    expect(created.url.startsWith('wondermoney://pair?')).toBe(true);
  });

  it('refuses a code one millisecond past its lifetime', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const now = new Date('2026-05-01T10:00:00Z');
    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em, now });
    const port = sessions();

    const expired = await claimPairingCode(
      { code: created.code },
      { em, now: new Date(created.expiresAt.getTime() + 1), sessions: port },
    );

    expect(expired).toEqual({ status: 'invalid' });
    expect(port.created).toEqual([]);
  });

  it('accepts a code right up to its expiry instant', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const now = new Date('2026-05-01T10:00:00Z');
    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em, now });

    const claimed = await claimPairingCode(
      { code: created.code },
      { em, now: new Date(created.expiresAt.getTime() - 1), sessions: sessions() },
    );

    expect(claimed.status).toBe('paired');
  });

  it('works once: a second exchange of the same code is refused', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em });
    const port = sessions();

    const first = await claimPairingCode({ code: created.code }, { em, sessions: port });
    const second = await claimPairingCode({ code: created.code }, { em, sessions: port });

    expect(first.status).toBe('paired');
    expect(second).toEqual({ status: 'invalid' });
    expect(port.created).toHaveLength(1);
  });

  it('records the session on the pairing row and labels the device from the user agent', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em });

    const claimed = await claimPairingCode(
      { code: created.code, userAgent: 'WonderMoney/1.0.2 (iOS 18.0)' },
      { em, sessions: sessions() },
    );

    expect(claimed.status).toBe('paired');
    if (claimed.status !== 'paired') return;
    const row = await em.findOneOrFail(MobilePairing, { codeHash: hashPairingCode(created.code) });
    expect(row.sessionId).toBe(claimed.session.sessionId);
    expect(row.claimedAt).toBeInstanceOf(Date);
    expect(row.deviceLabel).toBe('WonderMoney/1.0.2 (iOS 18.0)');
  });

  it('lists only claimed, unrevoked devices whose session still exists', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const port = sessions();
    const paired = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em });
    await claimPairingCode({ code: paired.code, userAgent: 'WonderMoney/1.0.2 (Android 15)' }, { em, sessions: port });
    // A second code that was never scanned is not a device.
    await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em });

    const devices = await listMobileDevices(appuser, { em, sessions: port });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      label: 'WonderMoney/1.0.2 (Android 15)',
      lastSeenAt: new Date('2026-01-02T00:00:00Z'),
    }));
  });

  it('revoking a device deletes its session and removes it from the list', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const port = sessions();
    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em });
    const claimed = await claimPairingCode({ code: created.code }, { em, sessions: port });
    if (claimed.status !== 'paired') throw new Error('pairing failed');

    await revokeMobileDevice(appuser, claimed.session.sessionId, { em, sessions: port });

    expect(port.deleted).toEqual([claimed.session.sessionId]);
    expect(await listMobileDevices(appuser, { em, sessions: port })).toEqual([]);
    await expect(revokeMobileDevice(appuser, claimed.session.sessionId, { em, sessions: port })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot revoke another person's device", async () => {
    const em = db.em();
    const first = await seedHousehold(em);
    const second = await seedHousehold(em);
    const port = sessions();
    const created = await createPairingCode({ appuser: first.appuser, serverUrl: 'https://api.example.test' }, { em });
    const claimed = await claimPairingCode({ code: created.code }, { em, sessions: port });
    if (claimed.status !== 'paired') throw new Error('pairing failed');

    await expect(
      revokeMobileDevice(second.appuser, claimed.session.sessionId, { em, sessions: port }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(port.deleted).toEqual([]);
  });
});

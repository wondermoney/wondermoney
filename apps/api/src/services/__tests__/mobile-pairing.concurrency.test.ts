import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import {
  claimPairingCode,
  createPairingCode,
  type MobileSessionPort,
} from '@service/auth/mobile-pairing.service';

/*
 * Two phones can scan the same QR at the same moment (a screenshot shared by mistake, a double
 * tap). The claim is a conditional UPDATE, so exactly one exchange may create a session.
 * Contention needs a real server: PGlite is a single backend (see `pg-test-db.ts`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('claiming one pairing code from two phones at once', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  it('creates exactly one session when the same code is exchanged concurrently', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const created = await createPairingCode({ appuser, serverUrl: 'https://api.example.test' }, { em });

    let createdSessions = 0;
    const sessions: MobileSessionPort = {
      createSession: () => {
        createdSessions += 1;
        const id = `session-${createdSessions}`;
        return Promise.resolve({
          cookieName: 'better-auth.session_token',
          cookieValue: `signed-${id}`,
          expiresAt: new Date('2026-01-08T00:00:00Z'),
          sessionId: id,
          token: `token-${id}`,
        });
      },
      deleteSession: () => Promise.resolve(),
      listSessions: () => Promise.resolve([]),
    };

    const results = await Promise.all(
      Array.from({ length: 4 }, () => claimPairingCode({ code: created.code }, { em: db.em(), sessions })),
    );

    expect(results.filter((result) => result.status === 'paired')).toHaveLength(1);
    expect(createdSessions).toBe(1);
  });
});

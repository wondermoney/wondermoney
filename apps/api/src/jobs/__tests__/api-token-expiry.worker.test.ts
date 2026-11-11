import { beforeEach, describe, expect, it, vi } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { pgBossJob } from '@app/__tests__/__helpers__/pgboss-job';
import { DI } from '@app/database/di';
import { handleApiTokenExpiryReminderJob } from '@app/jobs/api-token-expiry.worker';
import { ApiToken } from '@entity/ApiToken';
import { createApiToken } from '@service/api-token/api-token.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

const db = useTestDatabase();

const NOW = new Date('2026-06-01T09:00:00Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

describe('API token expiry reminder job', () => {
  beforeEach(() => {
    DI.em = db.em();
  });

  async function tokenExpiringIn(days: number, input: { revoked?: boolean } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const { apiToken } = await createApiToken(
      { appuser: household.appuser, expiresInDays: 30, name: 'Dashboard', scopes: ['read'], tenant: household.tenant },
      em,
    );
    apiToken.expiresAt = inDays(days);
    if (input.revoked) apiToken.revokedAt = NOW;
    await em.flush();
    return { apiToken, household };
  }

  it('emails a reminder for a token expiring inside the seven-day window', async () => {
    const { household } = await tokenExpiringIn(5);
    const sendEmail = vi.fn().mockResolvedValue({ type: 'accepted' });

    const result = await handleApiTokenExpiryReminderJob(pgBossJob({}), {
      em: db.em(),
      isEmailConfigured: () => true,
      now: () => NOW,
      sendEmail,
    });

    expect(result).toMatchObject({ sent: 1 });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: household.appuser.emailAddress }),
      expect.objectContaining({ tokenName: 'Dashboard' }),
    );
  });

  it('marks the reminder so a retry does not send it twice', async () => {
    await tokenExpiringIn(5);
    const sendEmail = vi.fn().mockResolvedValue({ type: 'accepted' });

    await handleApiTokenExpiryReminderJob(pgBossJob({}), {
      em: db.em(), isEmailConfigured: () => true, now: () => NOW, sendEmail,
    });
    await handleApiTokenExpiryReminderJob(pgBossJob({}), {
      em: db.em(), isEmailConfigured: () => true, now: () => NOW, sendEmail,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const stored = await db.em().findOneOrFail(ApiToken, { apiTokenKey: { $gt: 0 } });
    expect(stored.reminderSentAt?.getTime()).toBe(NOW.getTime());
  });

  it('ignores tokens outside the window, revoked tokens and already-expired tokens', async () => {
    await tokenExpiringIn(30);
    await tokenExpiringIn(5, { revoked: true });
    await tokenExpiringIn(-1);
    const sendEmail = vi.fn().mockResolvedValue({ type: 'accepted' });

    const result = await handleApiTokenExpiryReminderJob(pgBossJob({}), {
      em: db.em(), isEmailConfigured: () => true, now: () => NOW, sendEmail,
    });

    expect(result).toMatchObject({ scanned: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when no email provider is configured', async () => {
    await tokenExpiringIn(5);
    const sendEmail = vi.fn();

    const result = await handleApiTokenExpiryReminderJob(pgBossJob({}), {
      em: db.em(), isEmailConfigured: () => false, now: () => NOW, sendEmail,
    });

    expect(result).toMatchObject({ sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    const stored = await db.em().findOneOrFail(ApiToken, { apiTokenKey: { $gt: 0 } });
    expect(stored.reminderSentAt).toBeNull();
  });
});

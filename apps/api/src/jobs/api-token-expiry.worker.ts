import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { ApiToken } from '@entity/ApiToken';
import type { Appuser } from '@entity/Appuser';
import { sendApiTokenExpiryEmail } from '@service/email/email';
import { isEmailConfigured } from '@service/email/email-transport';
import logger from '@utils/logger';

const REMINDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface ApiTokenExpiryDeps {
  em?: EntityManager;
  isEmailConfigured?: () => boolean;
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  sendEmail?: typeof sendApiTokenExpiryEmail;
}

/**
 * Email a seven-day reminder for every live token that expires inside the window.
 *
 * The worker EM has no tenant context, so the query spans every household; each token is
 * handled independently. `reminderSentAt` makes the daily run idempotent: a token is reminded
 * once, and a retry after a partial failure skips the ones already sent.
 *
 * With no email provider configured (`EMAIL_DRIVER=log` or nothing set) the job does nothing:
 * a reminder written to the API log is not a reminder.
 */
export const handleApiTokenExpiryReminderJob = async (
  job: Job<Record<string, never>>,
  deps: ApiTokenExpiryDeps = {},
) => {
  const em = deps.em ?? DI.em;
  const log = deps.logger ?? logger;
  const now = deps.now?.() ?? new Date();
  const emailConfigured = deps.isEmailConfigured ?? (() => isEmailConfigured());

  if (!emailConfigured()) {
    log.info({ jobId: job.id, queue: 'api-token.expiry-reminder' }, 'API token expiry reminder skipped: no email provider configured');
    return { sent: 0, skipped: 0 };
  }

  const tokens = await em.find(
    ApiToken,
    {
      deletedAt: null,
      expiresAt: { $gt: now, $lte: new Date(now.getTime() + REMINDER_WINDOW_MS) },
      reminderSentAt: null,
      revokedAt: null,
    },
    { filters: false, populate: ['appuserKey'] },
  );

  const sendEmail = deps.sendEmail ?? sendApiTokenExpiryEmail;
  let sent = 0;
  let failed = 0;
  for (const apiToken of tokens) {
    const appuser = apiToken.appuserKey as Appuser;
    if (!appuser.emailAddress) continue;
    try {
      await sendEmail(
        { email: appuser.emailAddress, name: [appuser.firstName, appuser.lastName].filter(Boolean).join(' ') || undefined },
        { expiresAt: apiToken.expiresAt, language: appuser.language, tokenName: apiToken.name },
      );
      apiToken.reminderSentAt = now;
      sent += 1;
    } catch (error) {
      failed += 1;
      log.warn({ apiTokenKey: apiToken.apiTokenKey, error, jobId: job.id }, 'API token expiry reminder failed for a token');
    }
  }

  await em.flush();
  const result = { failed, scanned: tokens.length, sent };
  log.info({ jobId: job.id, ...result, queue: 'api-token.expiry-reminder' }, 'API token expiry reminder finished');
  if (failed > 0) throw new Error(`API token expiry reminder failed for ${failed} of ${tokens.length} tokens`);
  return result;
};

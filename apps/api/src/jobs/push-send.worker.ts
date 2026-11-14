import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { parsePushSendPayload, type PushSendPayload } from '@app/jobs/push-send.queue';
import { ExpoPushRequestError } from '@service/push/expo-push-client';
import { checkPushReceipts, type PushSenderDeps, sendPushNotification } from '@service/push/push-sender';
import logger from '@utils/logger';

/**
 * One `push-send` job. An answer from Expo that may clear (429, 5xx, no answer) throws, so pg-boss
 * retries the job; every other outcome is final. An invalid payload is dropped.
 */
export async function handlePushSendJob(job: Job<unknown>, deps: PushSenderDeps & { logger?: Pick<Logger, 'info' | 'warn'> }) {
  const log = deps.logger ?? logger;
  let payload: PushSendPayload;
  try {
    payload = parsePushSendPayload(job.data);
  } catch {
    log.warn({ jobId: job.id, queue: 'push-send' }, 'Push send job payload is invalid');
    return false;
  }
  try {
    if (payload.type === 'receipts') {
      const result = await checkPushReceipts(payload.tickets, deps);
      log.info({ ...result, jobId: job.id, queue: 'push-send' }, 'Push receipts checked');
      return result;
    }
    const result = await sendPushNotification({ appuserKey: payload.appuserKey, notification: payload.notification }, deps);
    log.info({ appuserKey: payload.appuserKey, jobId: job.id, kind: payload.notification.kind, queue: 'push-send', ...result }, 'Push send job resolved');
    return result;
  } catch (error) {
    // A refusal that will not clear (a malformed request, a rejected access token): retrying cannot help.
    if (!(error instanceof ExpoPushRequestError)) throw error;
    log.warn({ jobId: job.id, message: error.message, queue: 'push-send' }, 'Expo push service refused the request');
    return false;
  }
}

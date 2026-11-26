import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { enqueueBankSyncAlertSend, parseBankSyncAlertSendPayload } from '@app/jobs/bank-sync-alert.queue';
import type { BankSyncAlertChannels } from '@service/bank-sync-alerts/bank-sync-alert-channel';
import { createBankSyncAlertEmailChannel } from '@service/bank-sync-alerts/bank-sync-alert-email.channel';
import { createBankSyncAlertPushChannel } from '@service/bank-sync-alerts/bank-sync-alert-push.channel';
import { sendBankSyncAlert, sweepBankSyncAlerts } from '@service/bank-sync-alerts/bank-sync-alert.service';
import { EnableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

/**
 * The daily bank sync pass: first it deletes the generated Enable Banking keys whose seven days ran
 * out unactivated (their encrypted private key has no further use), then it decides the alerts.
 */
export async function handleBankSyncAlertSweepJob(deps: { enqueue: Enqueue; logger?: Pick<Logger, 'info' | 'warn'>; now?: Date }) {
  const now = deps.now ?? new Date();
  const log = deps.logger ?? logger;
  // A failed purge waits for tomorrow's run; it never costs today's alerts. The rows hold only
  // ciphertext, and the error is logged by its message alone.
  let purgedPendingCredentials: null | number = null;
  try {
    purgedPendingCredentials = await new EnableBankingCredentialService(DI.em).purgeLapsedPendingCredentials(now);
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), queue: 'bank-sync-alert.sweep' }, 'Purging lapsed pending Enable Banking keys failed');
  }
  const result = await sweepBankSyncAlerts({
    em: DI.em,
    enqueueSend: (deliveryKey) => enqueueBankSyncAlertSend(deliveryKey, { enqueue: deps.enqueue }),
    now,
  });
  log.info({ ...result, purgedPendingCredentials, queue: 'bank-sync-alert.sweep' }, 'Bank sync alert sweep finished');
  return result;
}

/** A provider refusal before acceptance throws, so pg-boss retries the job; every other outcome is final. */
export async function handleBankSyncAlertSendJob(job: Job<unknown>, deps: { channels?: BankSyncAlertChannels; enqueue?: Enqueue; logger?: Pick<Logger, 'info' | 'warn'> } = {}) {
  const log = deps.logger ?? logger;
  let deliveryKey: number;
  try {
    ({ deliveryKey } = parseBankSyncAlertSendPayload(job.data));
  } catch {
    log.warn({ jobId: job.id, queue: 'bank-sync-alert.send' }, 'Bank sync alert job payload is invalid');
    return false;
  }
  const { enqueue } = deps;
  const channels = deps.channels ?? {
    email: createBankSyncAlertEmailChannel(),
    push: createBankSyncAlertPushChannel({
      em: DI.em,
      enabled: enqueue ? undefined : () => false,
      enqueue: () => {
        if (!enqueue) throw new Error('No queue for push alerts');
        return enqueue;
      },
    }),
  };
  const result = await sendBankSyncAlert(deliveryKey, { channels, em: DI.em });
  log.info({ deliveryKey, jobId: job.id, outcomeCode: result?.outcomeCode, status: result?.status ?? 'not_pending' }, 'Bank sync alert job resolved');
  if (result?.retry) throw new Error('Bank sync alert provider refused the message before acceptance');
  return true;
}

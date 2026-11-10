import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { enqueueBankSyncAlertSend, parseBankSyncAlertSendPayload } from '@app/jobs/bank-sync-alert.queue';
import type { BankSyncAlertChannels } from '@service/bank-sync-alerts/bank-sync-alert-channel';
import { createBankSyncAlertEmailChannel } from '@service/bank-sync-alerts/bank-sync-alert-email.channel';
import { sendBankSyncAlert, sweepBankSyncAlerts } from '@service/bank-sync-alerts/bank-sync-alert.service';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

export async function handleBankSyncAlertSweepJob(deps: { enqueue: Enqueue; logger?: Pick<Logger, 'info'>; now?: Date }) {
  const result = await sweepBankSyncAlerts({
    em: DI.em,
    enqueueSend: (deliveryKey) => enqueueBankSyncAlertSend(deliveryKey, { enqueue: deps.enqueue }),
    now: deps.now ?? new Date(),
  });
  (deps.logger ?? logger).info({ ...result, queue: 'bank-sync-alert.sweep' }, 'Bank sync alert sweep finished');
  return result;
}

/** A provider refusal before acceptance throws, so pg-boss retries the job; every other outcome is final. */
export async function handleBankSyncAlertSendJob(job: Job<unknown>, deps: { channels?: BankSyncAlertChannels; logger?: Pick<Logger, 'info' | 'warn'> } = {}) {
  const log = deps.logger ?? logger;
  let deliveryKey: number;
  try {
    ({ deliveryKey } = parseBankSyncAlertSendPayload(job.data));
  } catch {
    log.warn({ jobId: job.id, queue: 'bank-sync-alert.send' }, 'Bank sync alert job payload is invalid');
    return false;
  }
  const result = await sendBankSyncAlert(deliveryKey, { channels: deps.channels ?? { email: createBankSyncAlertEmailChannel() }, em: DI.em });
  log.info({ deliveryKey, jobId: job.id, outcomeCode: result?.outcomeCode, status: result?.status ?? 'not_pending' }, 'Bank sync alert job resolved');
  if (result?.retry) throw new Error('Bank sync alert provider refused the message before acceptance');
  return true;
}

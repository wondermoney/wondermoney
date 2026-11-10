import { type EntityManager, LockMode } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { BankSyncAlertChannel, BankSyncAlertDelivery, BankSyncAlertDeliveryStatus } from '@entity/BankSyncAlertDelivery';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { loadConnectionHealth } from '@service/bank-sync-alerts/bank-sync-alert-health.repository';
import { decideBankSyncAlert } from '@service/bank-sync-alerts/bank-sync-alert-policy';

import type { BankSyncAlertChannelOutcome, BankSyncAlertChannels } from './bank-sync-alert-channel';

/** The channels every alert goes out on. Push joins this list once mobile push exists. */
const BANK_SYNC_ALERT_CHANNELS: readonly BankSyncAlertChannel[] = [BankSyncAlertChannel.EMAIL];

export interface SweepBankSyncAlertsInput {
  em: EntityManager;
  /** Queues one send of the delivery; a queue-level singleton per delivery keeps it to one job. */
  enqueueSend: (deliveryKey: number) => Promise<unknown>;
  now: Date;
}

/**
 * The daily pass: decide every connection's alert and record one delivery per channel. A delivery
 * already recorded for the same connection, event and episode is left alone, so a repeat sweep
 * sends nothing new; one still pending (its job lost or still queued) is queued again.
 */
export interface SendBankSyncAlertDependencies {
  channels: BankSyncAlertChannels;
  em: EntityManager;
  now?: () => Date;
}

export interface SendBankSyncAlertResult {
  outcomeCode?: string;
  /** The provider refused it for now: the job should throw so the queue tries again. */
  retry: boolean;
  status: BankSyncAlertDeliveryStatus;
}

export async function sweepBankSyncAlerts(input: SweepBankSyncAlertsInput): Promise<{ alerts: number; enqueued: number }> {
  const connections = await loadConnectionHealth(input.em, { scope: 'all' });
  let alerts = 0;
  let enqueued = 0;
  for (const connection of connections) {
    const decision = decideBankSyncAlert(connection, input.now);
    if (!decision) continue;
    alerts += 1;
    for (const channel of BANK_SYNC_ALERT_CHANNELS) {
      await input.em.getConnection().execute(
        `insert into bank_sync_alert_delivery (appuser_key, enable_banking_connection_key, event, episode_key, channel, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (enable_banking_connection_key, event, episode_key, channel) do nothing`,
        [connection.appuserKey, connection.enableBankingConnectionKey, decision.event, decision.episodeKey, channel, BankSyncAlertDeliveryStatus.PENDING, input.now, input.now],
      );
      const delivery = await input.em.findOne(BankSyncAlertDelivery, {
        channel, enableBankingConnectionKey: { enableBankingConnectionKey: connection.enableBankingConnectionKey }, episodeKey: decision.episodeKey, event: decision.event,
      }, { disableIdentityMap: true, fields: ['bankSyncAlertDeliveryKey', 'status'] });
      if (delivery?.status !== BankSyncAlertDeliveryStatus.PENDING) continue;
      await input.enqueueSend(delivery.bankSyncAlertDeliveryKey);
      enqueued += 1;
    }
  }
  return { alerts, enqueued };
}

/**
 * Sends one delivery, at most once. The row is claimed (`pending` → `sending`) before anything
 * leaves, so a job that runs twice, or crashes after the provider took the message, cannot send
 * it again. Right before sending, the alert is decided again from fresh data: a connection
 * reconnected or synced since the sweep is no longer worth an email.
 */
export async function sendBankSyncAlert(deliveryKey: number, dependencies: SendBankSyncAlertDependencies): Promise<null | SendBankSyncAlertResult> {
  const { em } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const delivery = await em.transactional(async (tx) => {
    const row = await tx.findOne(BankSyncAlertDelivery, { bankSyncAlertDeliveryKey: deliveryKey }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (row?.status !== BankSyncAlertDeliveryStatus.PENDING) return null;
    row.status = BankSyncAlertDeliveryStatus.SENDING;
    await tx.flush();
    return row;
  });
  if (!delivery) return null;

  const finish = async (status: BankSyncAlertDeliveryStatus, outcomeCode?: string, providerMessageId?: string): Promise<SendBankSyncAlertResult> => {
    const at = now();
    em.assign(delivery, {
      completedAt: status === BankSyncAlertDeliveryStatus.PENDING ? undefined : at,
      outcomeCode,
      providerMessageId,
      sentAt: status === BankSyncAlertDeliveryStatus.SENT ? at : undefined,
      status,
    });
    await em.flush();
    return { outcomeCode, retry: status === BankSyncAlertDeliveryStatus.PENDING, status };
  };
  const suppress = (reason: string) => finish(BankSyncAlertDeliveryStatus.SUPPRESSED, reason);

  const connectionKey = relationKey(delivery.enableBankingConnectionKey, 'enableBankingConnectionKey');
  const [health] = await loadConnectionHealth(em, { enableBankingConnectionKey: connectionKey, scope: 'connection' });
  const decision = health ? decideBankSyncAlert(health, now()) : null;
  if (!health || decision?.event !== delivery.event || decision.episodeKey !== delivery.episodeKey) return suppress('resolved');
  if (health.appuserKey !== relationKey(delivery.appuserKey, 'appuserKey')) return suppress('owner_changed');

  const recipient = await em.findOne(Appuser, { appuserKey: health.appuserKey });
  if (!recipient) return suppress('recipient_unreachable');
  const preference = await em.findOne(EmailNotificationPreference, { appuserKey: recipient, deletedAt: null });
  const handler = dependencies.channels[delivery.channel];
  const blocked = handler.gate(recipient, preference);
  if (blocked) return suppress(blocked);

  let outcome: BankSyncAlertChannelOutcome;
  try {
    outcome = await handler.deliver({
      accessValidUntil: health.accessValidUntil,
      bankName: health.aspspName,
      deliveryId: `bank-sync-alert-${delivery.bankSyncAlertDeliveryKey}`,
      event: delivery.event,
      failingSince: health.failureStreak?.since ?? null,
      recipient,
    });
  } catch {
    // A throw after the provider call started may still have delivered it.
    outcome = { code: 'channel_error', type: 'unknown' };
  }
  switch (outcome.type) {
    case 'delivered':
      return finish(BankSyncAlertDeliveryStatus.SENT, 'sent', outcome.providerMessageId);
    case 'failed':
      return finish(BankSyncAlertDeliveryStatus.FAILED, outcome.code);
    case 'retryable':
      return finish(BankSyncAlertDeliveryStatus.PENDING, outcome.code);
    case 'unknown':
      return finish(BankSyncAlertDeliveryStatus.UNKNOWN, outcome.code);
  }
}

function relationKey(relation: unknown, key: 'appuserKey' | 'enableBankingConnectionKey'): number {
  if (typeof relation === 'number') return relation;
  const value = (relation as null | Record<string, unknown>)?.[key];
  if (typeof value !== 'number') throw new Error('Bank sync alert delivery relation is not loaded');
  return value;
}

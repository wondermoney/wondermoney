import type { Appuser } from '@entity/Appuser';
import type { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { isRecipientReachable } from '@service/email/email-preferences';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

import type { PushNotification } from './push-messages';
import { type QueuePushDeps, queuePushNotification } from './push-notifier';

/** What a notification channel (card reminders, bank sync alerts) reports back for one delivery. */
export interface PushChannelDeps {
  em?: QueuePushDeps['em'];
  enabled?: () => boolean;
  /** Built lazily: a channel is created once per job, the queue is only needed when it sends. */
  enqueue: () => Enqueue;
}

export type PushChannelOutcome =
  | { code: string; type: 'failed' }
  | { code: string; type: 'retryable' }
  | { type: 'delivered' };

type PushPreferenceColumn = 'pushBankSyncAlertsEnabled' | 'pushCreditCardDueRemindersEnabled';

/** The shared gate of the push channels: an account that can be reached, and its own push switch on. */
export function pushChannelGate(recipient: Appuser, preference: EmailNotificationPreference | null, column: PushPreferenceColumn, offCode: string): string | undefined {
  if (!isRecipientReachable(recipient)) return 'recipient_unreachable';
  if (preference?.[column] !== true) return offCode;
  return undefined;
}

/**
 * Hands one notification to the push queue. "Delivered" here means queued for the push worker, which
 * sends it and handles Expo's answers; a person with no registered phone is a final `no_push_device`.
 */
export async function deliverPushNotification(appuserKey: number, notification: PushNotification, deps: PushChannelDeps): Promise<PushChannelOutcome> {
  try {
    const outcome = await queuePushNotification(appuserKey, notification, { em: deps.em, enabled: deps.enabled, enqueue: deps.enqueue() });
    switch (outcome) {
      case 'disabled':
        return { code: 'push_disabled', type: 'failed' };
      case 'no_devices':
        return { code: 'no_push_device', type: 'failed' };
      case 'preference_off':
        return { code: 'push_preference_off', type: 'failed' };
      case 'queued':
        return { type: 'delivered' };
    }
  } catch (error) {
    logger.warn({ appuserKey, error }, 'Could not queue a push notification');
    return { code: 'push_queue_unavailable', type: 'retryable' };
  }
}

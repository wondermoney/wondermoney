import { isPushEnabled } from '@config/push';
import { deliverPushNotification, type PushChannelDeps, pushChannelGate } from '@service/push/push-channel';

import type { CreditCardDueReminderChannelHandler, CreditCardDueReminderMessage } from './credit-card-due-reminder.service';

/**
 * Payment-due reminders as a push notification, for owners who turned the card-reminders push
 * category on. The text says when the payment is due, never how much or on which card. With push
 * off on this server the channel is unavailable and records nothing.
 */
export function createCreditCardDueReminderPushChannel(deps: PushChannelDeps): CreditCardDueReminderChannelHandler {
  const enabled = deps.enabled ?? (() => isPushEnabled());
  return {
    available: enabled,
    deliver: (message: CreditCardDueReminderMessage) => deliverPushNotification(
      message.recipient.appuserKey,
      { accountKey: message.accountKey, daysUntilDue: Math.max(0, message.daysUntilDue), kind: 'credit_card_due' },
      { ...deps, enabled },
    ),
    gate: (recipient, preference) => pushChannelGate(recipient, preference, 'pushCreditCardDueRemindersEnabled', 'push_credit_card_due_reminders_disabled'),
  };
}

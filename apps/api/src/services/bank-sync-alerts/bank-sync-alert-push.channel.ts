import { isPushEnabled } from '@config/push';
import { deliverPushNotification, type PushChannelDeps, pushChannelGate } from '@service/push/push-channel';

import type { BankSyncAlertChannelHandler, BankSyncAlertMessage } from './bank-sync-alert-channel';

/**
 * Bank sync alerts as a push notification, for owners who turned the bank-alerts push category on.
 * The text says a connection needs attention, not which bank. The sweep only records push
 * deliveries while push is on (`bankSyncAlertChannels`).
 */
export function createBankSyncAlertPushChannel(deps: PushChannelDeps): BankSyncAlertChannelHandler {
  const enabled = deps.enabled ?? (() => isPushEnabled());
  return {
    deliver: (message: BankSyncAlertMessage) => deliverPushNotification(message.recipient.appuserKey, { event: message.event, kind: 'bank_sync_alert' }, { ...deps, enabled }),
    gate: (recipient, preference) => {
      if (!enabled()) return 'push_disabled';
      return pushChannelGate(recipient, preference, 'pushBankSyncAlertsEnabled', 'push_bank_sync_alerts_disabled');
    },
  };
}

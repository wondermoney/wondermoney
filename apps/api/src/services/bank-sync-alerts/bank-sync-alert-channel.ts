import type { Appuser } from '@entity/Appuser';
import type { BankSyncAlertChannel, BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';
import type { EmailNotificationPreference } from '@entity/EmailNotificationPreference';

/**
 * A way of telling the user about a bank sync alert. The decision (what, when, dedupe) is made
 * once in `bank-sync-alert-policy.ts` and recorded per channel in `BankSyncAlertDelivery`; a channel
 * only checks that its recipient wants and can receive it, and delivers. Email is the one channel
 * today. Mobile push plugs in here as a second channel with its own gate (a registered device and
 * its own preference) and its own delivery rows.
 */
export interface BankSyncAlertChannelHandler {
  deliver(message: BankSyncAlertMessage): Promise<BankSyncAlertChannelOutcome>;
  /** Why this recipient must not get it on this channel (written to the delivery as its outcome), or undefined to send. */
  gate(recipient: Appuser, preference: EmailNotificationPreference | null): string | undefined;
}

export type BankSyncAlertChannelOutcome =
  /** The provider took it. */
  | { providerMessageId?: string; type: 'delivered' }
  /** Refused for good; do not try again. */
  | { code: string; type: 'failed' }
  /** Refused before acceptance for a reason that may clear; try again later. */
  | { code: string; type: 'retryable' }
  /** No answer: it may have been delivered, so it is never tried again. */
  | { code: string; type: 'unknown' };

export type BankSyncAlertChannels = Record<BankSyncAlertChannel, BankSyncAlertChannelHandler>;

export interface BankSyncAlertMessage {
  /** The consent's end date (the consent alerts). */
  accessValidUntil: Date | null;
  bankName: string;
  /** Unique per delivery: lets a provider drop a duplicate if the same delivery is sent twice. */
  deliveryId: string;
  event: BankSyncAlertEventType;
  /** The first failed sync of the streak (`sync_failing`). */
  failingSince: Date | null;
  recipient: Appuser;
}

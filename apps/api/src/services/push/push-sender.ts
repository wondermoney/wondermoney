import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { enqueuePushReceiptCheck, PUSH_RECEIPT_DELAY_MS, type PushSendPayload } from '@app/jobs/push-send.queue';
import { isPushEnabled } from '@config/push';
import type { SupportedLanguages } from '@entity/Appuser';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

import { ExpoPushClient, type ExpoPushMessage } from './expo-push-client';
import { PushDeviceService } from './push-device.service';
import { pushCategoryOf, pushLanguageFor, type PushNotification, renderPush } from './push-messages';
import { PushPreferenceService } from './push-preference.service';

/** The error Expo reports, on a ticket or a receipt, for a token that no longer reaches a device. */
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

export interface PushSenderDeps {
  client?: Pick<ExpoPushClient, 'getReceipts' | 'send'>;
  em?: EntityManager;
  enabled?: () => boolean;
  enqueue: Enqueue;
  now?: () => Date;
}

export type PushSendOutcome =
  | { failed: number; sent: number; status: 'sent'; unregistered: number }
  | { reason: 'disabled' | 'no_devices' | 'preference_off' | 'user_unavailable'; status: 'skipped' };

/**
 * Sends one notification to every live device of one person. Everything is checked again here,
 * whatever the producer checked when it queued it: the server switch, the person's account, the
 * category's switch and their devices. A ticket Expo answers with `DeviceNotRegistered` disables
 * that token at once; the other tickets are checked again through their receipts later.
 */
export async function sendPushNotification(input: { appuserKey: number; notification: PushNotification }, deps: PushSenderDeps): Promise<PushSendOutcome> {
  const enabled = deps.enabled ?? (() => isPushEnabled());
  if (!enabled()) return { reason: 'disabled', status: 'skipped' };
  const em = deps.em ?? DI.em;
  const now = deps.now ?? (() => new Date());

  const appuserRow = await em.getConnection().execute<{ language: SupportedLanguages }>(
    'select "language" from "appuser" where "appuser_key" = ? and "record_active" = true and "deleted_at" is null',
    [input.appuserKey],
    'get',
  );
  // `execute(..., 'get')` resolves to undefined when there is no row, but is typed as the row.
  const appuser = appuserRow as typeof appuserRow | undefined;
  if (!appuser) return { reason: 'user_unavailable', status: 'skipped' };

  const category = pushCategoryOf(input.notification);
  if (category && !(await new PushPreferenceService(em).isEnabled(input.appuserKey, category))) return { reason: 'preference_off', status: 'skipped' };

  const devices = new PushDeviceService(em);
  const live = await devices.liveDevices(input.appuserKey, now());
  if (live.length === 0) return { reason: 'no_devices', status: 'skipped' };

  const rendered = renderPush(input.notification, pushLanguageFor(appuser.language));
  const messages: ExpoPushMessage[] = live.map((device) => ({
    body: rendered.body,
    channelId: 'default',
    data: rendered.data,
    priority: 'high',
    sound: 'default',
    title: rendered.title,
    to: device.token,
  }));
  const tickets = await (deps.client ?? new ExpoPushClient()).send(messages);

  const unregistered: number[] = [];
  const receipts: { id: string; pushDeviceKey: number }[] = [];
  let failed = 0;
  tickets.forEach((ticket, index) => {
    const device = live[index];
    if (!device) return;
    if (ticket.status === 'ok') receipts.push({ id: ticket.id, pushDeviceKey: device.pushDeviceKey });
    else if (ticket.details?.error === DEVICE_NOT_REGISTERED) unregistered.push(device.pushDeviceKey);
    else failed += 1;
  });
  await devices.disable(unregistered, now());
  if (receipts.length > 0) {
    try {
      await enqueuePushReceiptCheck(receipts, new Date(now().getTime() + PUSH_RECEIPT_DELAY_MS), { enqueue: deps.enqueue });
    } catch (error) {
      // The notification went out; a missed receipt check only delays disabling a dead token to the next send.
      logger.warn({ appuserKey: input.appuserKey, error }, 'Could not queue the push receipt check');
    }
  }
  return { failed, sent: receipts.length, status: 'sent', unregistered: unregistered.length };
}

/** Reads the receipts of earlier sends and disables the tokens Expo reports as unregistered. */
export async function checkPushReceipts(tickets: Extract<PushSendPayload, { type: 'receipts' }>['tickets'], deps: Omit<PushSenderDeps, 'enqueue'>): Promise<{ checked: number; unregistered: number }> {
  const em = deps.em ?? DI.em;
  const now = deps.now ?? (() => new Date());
  const receipts = await (deps.client ?? new ExpoPushClient()).getReceipts(tickets.map((ticket) => ticket.id));
  const unregistered = tickets
    .filter((ticket) => {
      const receipt = receipts[ticket.id];
      return receipt?.status === 'error' && receipt.details?.error === DEVICE_NOT_REGISTERED;
    })
    .map((ticket) => ticket.pushDeviceKey);
  await new PushDeviceService(em).disable(unregistered, now());
  return { checked: Object.keys(receipts).length, unregistered: unregistered.length };
}

import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { enqueuePushSend } from '@app/jobs/push-send.queue';
import { isPushEnabled } from '@config/push';
import type { Enqueue } from '@service/queue/enqueue';

import { pushCategoryOf, type PushNotification } from './push-messages';
import { PushPreferenceService } from './push-preference.service';

export interface QueuePushDeps {
  em?: EntityManager;
  enabled?: () => boolean;
  enqueue: Enqueue;
}

export type QueuePushOutcome = 'disabled' | 'no_devices' | 'preference_off' | 'queued';

/**
 * Queues a push notification for one person, when push is on here, the notification's category is
 * on for them and they have a device to send it to. The worker checks all of it again when it sends.
 */
export async function queuePushNotification(appuserKey: number, notification: PushNotification, deps: QueuePushDeps): Promise<QueuePushOutcome> {
  if (!(deps.enabled ?? (() => isPushEnabled()))()) return 'disabled';
  const em = deps.em ?? DI.em;
  const category = pushCategoryOf(notification);
  if (category && !(await new PushPreferenceService(em).isEnabled(appuserKey, category))) return 'preference_off';
  if (!(await hasPushDevice(em, appuserKey))) return 'no_devices';
  await enqueuePushSend({ appuserKey, notification, type: 'send' }, { enqueue: deps.enqueue });
  return 'queued';
}

/** Whether this person has registered a device that is not disabled. */
export async function hasPushDevice(em: EntityManager, appuserKey: number): Promise<boolean> {
  const row = await em.getConnection().execute<{ found: boolean }>(
    'select exists(select 1 from "push_device" where "appuser_key" = ? and "disabled_at" is null) as "found"',
    [appuserKey],
    'get',
  );
  return row.found;
}

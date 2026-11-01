import type { EntityManager } from '@mikro-orm/core';

import { enqueueLifecycleSend } from '@app/jobs/lifecycle-send.queue';
import { upsertPendingDelivery } from '@service/lifecycle/lifecycle-delivery.service';
import type { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

export interface ScheduledStep {
  scheduledFor: Date;
  step: string;
}

/** Records a pending delivery + enqueues its send. Idempotent (upsert + singletonKey). */
async function scheduleLifecycleStep(em: EntityManager, enqueue: Enqueue, campaign: LifecycleCampaign, appuserKey: number, step: string, templateVersion: string, scheduledFor: Date): Promise<void> {
  await upsertPendingDelivery(em, { appuserKey, campaign, scheduledFor, step, templateVersion });
  await enqueueLifecycleSend({ appuserKey, campaign, step, templateVersion }, { enqueue }, scheduledFor);
}

/**
 * Boundary wrapper: schedules a set of steps for one user, managing its own
 * injected queue transport. Best-effort — never throws to the caller.
 */
export async function scheduleLifecycleSteps(em: EntityManager, enqueue: Enqueue, campaign: LifecycleCampaign, appuserKey: number, templateVersion: string, steps: ScheduledStep[]): Promise<void> {
  if (steps.length === 0) return;
  try {
    for (const s of steps) await scheduleLifecycleStep(em, enqueue, campaign, appuserKey, s.step, templateVersion, s.scheduledFor);
  } catch (error) {
    logger.warn({ appuserKey, campaign, error }, 'Lifecycle enqueue deferred');
  }
}

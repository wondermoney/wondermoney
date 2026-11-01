import { z } from 'zod';

import { deadLetterQueueName, ensureDeadLetterQueue } from '@app/jobs/dead-letter';
import { parseScheduledFor } from '@service/budget/aggregation-periods';
import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const BUDGET_EMAIL_COORDINATOR_QUEUE = 'email.budget.coordinator';
export const BUDGET_EMAIL_DELIVERY_QUEUE = 'email.budget.user';
export const WEEKLY_EMAIL_COORDINATOR_QUEUE = 'email.weekly.coordinator';
export const WEEKLY_EMAIL_DELIVERY_QUEUE = 'email.weekly.user';
export const MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE = 'email.monthly_story.coordinator';
export const MONTHLY_STORY_EMAIL_DELIVERY_QUEUE = 'email.monthly_story.user';
const BUDGET_EMAIL_SCHEDULE_KEY = 'email.budget.daily.lisbon';
const WEEKLY_EMAIL_SCHEDULE_KEY = 'email.weekly.monday.lisbon';
const MONTHLY_STORY_EMAIL_SCHEDULE_KEY = 'email.monthly_story.first_of_month.lisbon';
export const BUDGET_EMAIL_CRON = '0 9 * * *';
export const WEEKLY_EMAIL_CRON = '0 9 * * 1';
export const MONTHLY_STORY_EMAIL_CRON = '0 9 1 * *';
export const FINANCIAL_EMAIL_TIME_ZONE = 'Europe/Lisbon';

export interface FinancialEmailCoordinatorPayload { correlationId: string; cursor?: number; scheduledFor: string }
export interface FinancialEmailUserPayload extends FinancialEmailCoordinatorPayload { appuserKey: number }

const FINANCIAL_EMAIL_COORDINATOR_EXPIRE_SECONDS = 3_600;
export const BUDGET_EMAIL_MAX_AGE_SECONDS = 86_400;
export const WEEKLY_EMAIL_MAX_AGE_SECONDS = 259_200;
export const MONTHLY_STORY_EMAIL_MAX_AGE_SECONDS = 259_200;
const RETENTION_SECONDS = 604_800;
// pg-boss rejects expireInSeconds >= 24h (attorney.js: expireInSeconds / 3600 < MAX_EXPIRATION_HOURS).
// Staleness beyond this is already enforced at process time via *_MAX_AGE_SECONDS
// (see financial-email-user-worker.service.ts), so this only bounds pg-boss's own job expiry.
const PG_BOSS_MAX_EXPIRE_SECONDS = 23 * 60 * 60;
const pgBossExpireInSeconds = (maxAgeSeconds: number | undefined) => Math.min(maxAgeSeconds ?? PG_BOSS_MAX_EXPIRE_SECONDS, PG_BOSS_MAX_EXPIRE_SECONDS);
const coordinatorPayloadSchema = z.object({ correlationId: z.string().min(1), cursor: z.number().int().nonnegative().optional(), scheduledFor: z.iso.datetime({ offset: true }) });
const userPayloadSchema = coordinatorPayloadSchema.extend({ appuserKey: z.number().int().positive() });

const validateFinancialEmailCoordinatorPayload = (payload: FinancialEmailCoordinatorPayload) => coordinatorPayloadSchema.parse(payload);
export const validateFinancialEmailUserPayload = (payload: FinancialEmailUserPayload) => userPayloadSchema.parse(payload);

interface BossQueue { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }
interface BossSchedule { schedule: (queue: string, cron: string, data: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>; unschedule: (queue: string, key: string) => Promise<unknown> }

/** Every financial-email queue, in creation order. Exported so the worker can register one dead-letter consumer per queue. */
export const FINANCIAL_EMAIL_QUEUES = [BUDGET_EMAIL_COORDINATOR_QUEUE, BUDGET_EMAIL_DELIVERY_QUEUE, WEEKLY_EMAIL_COORDINATOR_QUEUE, WEEKLY_EMAIL_DELIVERY_QUEUE, MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE, MONTHLY_STORY_EMAIL_DELIVERY_QUEUE] as const;

export async function ensureFinancialEmailQueues(boss: BossQueue) {
  const maxAgeByDeliveryQueue: Record<string, number> = { [BUDGET_EMAIL_DELIVERY_QUEUE]: BUDGET_EMAIL_MAX_AGE_SECONDS, [MONTHLY_STORY_EMAIL_DELIVERY_QUEUE]: MONTHLY_STORY_EMAIL_MAX_AGE_SECONDS, [WEEKLY_EMAIL_DELIVERY_QUEUE]: WEEKLY_EMAIL_MAX_AGE_SECONDS };
  for (const queue of FINANCIAL_EMAIL_QUEUES) {
    const isCoordinator = queue.endsWith('.coordinator');
    // pg-boss requires the dead-letter queue to exist before the queue that names it.
    await ensureDeadLetterQueue(boss, queue);
    await boss.createQueue(queue, { deadLetter: deadLetterQueueName(queue), expireInSeconds: isCoordinator ? FINANCIAL_EMAIL_COORDINATOR_EXPIRE_SECONDS : pgBossExpireInSeconds(maxAgeByDeliveryQueue[queue]), policy: 'exclusive', retentionSeconds: RETENTION_SECONDS, retryBackoff: true, retryDelay: 60, retryLimit: 2 });
  }
}

for (const queue of FINANCIAL_EMAIL_QUEUES) {
  QUEUE_REGISTRY.set(queue, { ensure: ensureFinancialEmailQueues, name: queue });
}

export const scheduleBudgetEmails = (boss: BossSchedule) => boss.schedule(BUDGET_EMAIL_COORDINATOR_QUEUE, BUDGET_EMAIL_CRON, {}, { key: BUDGET_EMAIL_SCHEDULE_KEY, singletonKey: BUDGET_EMAIL_SCHEDULE_KEY, tz: FINANCIAL_EMAIL_TIME_ZONE });
export const scheduleWeeklyEmails = (boss: BossSchedule) => boss.schedule(WEEKLY_EMAIL_COORDINATOR_QUEUE, WEEKLY_EMAIL_CRON, {}, { key: WEEKLY_EMAIL_SCHEDULE_KEY, singletonKey: WEEKLY_EMAIL_SCHEDULE_KEY, tz: FINANCIAL_EMAIL_TIME_ZONE });
/** @public Paused with the lifecycle emails: `worker.ts` unschedules it and nothing schedules it. */
export const scheduleMonthlyStoryEmails = (boss: BossSchedule) => boss.schedule(MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE, MONTHLY_STORY_EMAIL_CRON, {}, { key: MONTHLY_STORY_EMAIL_SCHEDULE_KEY, singletonKey: MONTHLY_STORY_EMAIL_SCHEDULE_KEY, tz: FINANCIAL_EMAIL_TIME_ZONE });
export const unscheduleBudgetEmails = (boss: BossSchedule) => boss.unschedule(BUDGET_EMAIL_COORDINATOR_QUEUE, BUDGET_EMAIL_SCHEDULE_KEY);
export const unscheduleWeeklyEmails = (boss: BossSchedule) => boss.unschedule(WEEKLY_EMAIL_COORDINATOR_QUEUE, WEEKLY_EMAIL_SCHEDULE_KEY);
export const unscheduleMonthlyStoryEmails = (boss: BossSchedule) => boss.unschedule(MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE, MONTHLY_STORY_EMAIL_SCHEDULE_KEY);

export function enqueueFinancialEmailCoordinator(deps: { enqueue: Enqueue }, stream: 'budget' | 'monthlyStory' | 'weekly', payload: FinancialEmailCoordinatorPayload, periodKey: string) {
  validateFinancialEmailCoordinatorPayload(payload);
  parseScheduledFor(payload.scheduledFor);
  const queueByStream = { budget: BUDGET_EMAIL_COORDINATOR_QUEUE, monthlyStory: MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE, weekly: WEEKLY_EMAIL_COORDINATOR_QUEUE } as const;
  const queue = queueByStream[stream];
  return deps.enqueue.send(queue, payload, { expireInSeconds: FINANCIAL_EMAIL_COORDINATOR_EXPIRE_SECONDS, retentionSeconds: RETENTION_SECONDS, singletonKey: `${stream}:${periodKey}:cursor:${payload.cursor ?? 0}` });
}

export function enqueueFinancialEmailUser(deps: { enqueue: Enqueue }, stream: 'budget' | 'monthlyStory' | 'weekly', payload: FinancialEmailUserPayload, periodKey: string) {
  validateFinancialEmailUserPayload(payload);
  parseScheduledFor(payload.scheduledFor);
  const queueByStream = { budget: BUDGET_EMAIL_DELIVERY_QUEUE, monthlyStory: MONTHLY_STORY_EMAIL_DELIVERY_QUEUE, weekly: WEEKLY_EMAIL_DELIVERY_QUEUE } as const;
  const maxAgeByStream = { budget: BUDGET_EMAIL_MAX_AGE_SECONDS, monthlyStory: MONTHLY_STORY_EMAIL_MAX_AGE_SECONDS, weekly: WEEKLY_EMAIL_MAX_AGE_SECONDS };
  const queue = queueByStream[stream];
  return deps.enqueue.send(queue, payload, {
    expireInSeconds: pgBossExpireInSeconds(maxAgeByStream[stream]),
    retentionSeconds: RETENTION_SECONDS,
    retryBackoff: true,
    retryDelay: 60,
    retryLimit: 2,
    singletonKey: `${stream}:${periodKey}:${payload.appuserKey}`,
  });
}

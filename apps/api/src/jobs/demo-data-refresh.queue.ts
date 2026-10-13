export const DEMO_DATA_REFRESH_QUEUE = 'demo-data.refresh';
export const DEMO_DATA_REFRESH_CRON = '15 1 * * *';
export const DEMO_DATA_REFRESH_SINGLETON_KEY = 'demo-data.refresh.daily';

export interface DemoDataRefreshJobPayload {
  asOfDate?: string;
  correlationId?: string;
  dryRun?: boolean;
}

export const ensureDemoDataRefreshQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) =>
  boss.createQueue(DEMO_DATA_REFRESH_QUEUE, {
    expireInSeconds: 1_800,
    policy: 'exclusive',
    retryLimit: 1,
  });

QUEUE_REGISTRY.set(DEMO_DATA_REFRESH_QUEUE, { ensure: ensureDemoDataRefreshQueue, name: DEMO_DATA_REFRESH_QUEUE });

export const scheduleDemoDataRefreshJob = (boss: {
  schedule: (
    name: string,
    cron: string,
    data?: null | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}) =>
  boss.schedule(
    DEMO_DATA_REFRESH_QUEUE,
    DEMO_DATA_REFRESH_CRON,
    {},
    { key: DEMO_DATA_REFRESH_SINGLETON_KEY, singletonKey: DEMO_DATA_REFRESH_SINGLETON_KEY, tz: 'UTC' },
  );

export const enqueueDemoDataRefreshJob = (
  payload: DemoDataRefreshJobPayload,
  deps: { enqueue: Enqueue },
) => deps.enqueue.send(DEMO_DATA_REFRESH_QUEUE, payload);

export const unscheduleDemoDataRefreshJob = (
  boss: { unschedule?: (name: string, key: string) => Promise<unknown> },
  logger?: { warn: (data: Record<string, unknown>, message: string) => void },
) => {
  if (!boss.unschedule) {
    logger?.warn(
      { queue: DEMO_DATA_REFRESH_QUEUE, singletonKey: DEMO_DATA_REFRESH_SINGLETON_KEY },
      'pg-boss unschedule unavailable; skipping demo data refresh cleanup',
    );
    return undefined;
  }

  return Promise.all([
    boss.unschedule(DEMO_DATA_REFRESH_QUEUE, DEMO_DATA_REFRESH_SINGLETON_KEY),
  ]);
};
import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

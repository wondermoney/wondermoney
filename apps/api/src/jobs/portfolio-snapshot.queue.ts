export const PORTFOLIO_SNAPSHOT_AUTO_QUEUE = 'portfolio.snapshot.auto';
export const PORTFOLIO_SNAPSHOT_MANUAL_QUEUE = 'portfolio.snapshot.manual';
export const PORTFOLIO_SNAPSHOT_AUTO_CRON = '0 3 * * *';

export interface PortfolioSnapshotManualJobPayload {
  correlationId: string;
  portfolioId: number;
}

/** Continuation payload for the paged nightly sweep. `cursor` is the last `portfolioKey` snapshotted. */
export interface PortfolioSnapshotAutoJobPayload {
  correlationId?: string;
  cursor?: number;
}

/**
 * `expireInSeconds` is explicit because the 900 s default was silently wrong: the
 * sweep used to load *every* portfolio and snapshot them serially, so pg-boss
 * expired the job mid-run and — at `retryLimit: 0` — simply failed it, leaving
 * every portfolio after the cut-off with no snapshot for that date, permanently.
 * The handler now pages, so one job is bounded by `PORTFOLIO_SNAPSHOT_PAGE_SIZE`
 * portfolios, and 20 minutes is generous for that page.
 */
export const ensurePortfolioSnapshotAutoQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(PORTFOLIO_SNAPSHOT_AUTO_QUEUE, { expireInSeconds: 1_200, policy: 'exclusive', retryLimit: 0 });

export const ensurePortfolioSnapshotManualQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(PORTFOLIO_SNAPSHOT_MANUAL_QUEUE, { expireInSeconds: 3_600, policy: 'exclusive', retryLimit: 0 });

QUEUE_REGISTRY.set(PORTFOLIO_SNAPSHOT_AUTO_QUEUE, { ensure: ensurePortfolioSnapshotAutoQueue, name: PORTFOLIO_SNAPSHOT_AUTO_QUEUE });
QUEUE_REGISTRY.set(PORTFOLIO_SNAPSHOT_MANUAL_QUEUE, { ensure: ensurePortfolioSnapshotManualQueue, name: PORTFOLIO_SNAPSHOT_MANUAL_QUEUE });

/**
 * Enqueues the next page of the nightly sweep. The singleton key carries the cursor so
 * a page cannot be enqueued twice, while distinct pages stay distinct jobs.
 */
export const enqueuePortfolioSnapshotAutoContinuation = (
  deps: { enqueue: Enqueue },
  payload: Required<PortfolioSnapshotAutoJobPayload>,
) => deps.enqueue.send(PORTFOLIO_SNAPSHOT_AUTO_QUEUE, { ...payload }, { singletonKey: `${PORTFOLIO_SNAPSHOT_AUTO_QUEUE}:cursor:${payload.cursor}` });

export const schedulePortfolioSnapshotAutoJob = (boss: { schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.schedule(PORTFOLIO_SNAPSHOT_AUTO_QUEUE, PORTFOLIO_SNAPSHOT_AUTO_CRON, {}, { key: PORTFOLIO_SNAPSHOT_AUTO_QUEUE, singletonKey: PORTFOLIO_SNAPSHOT_AUTO_QUEUE, tz: 'UTC' });

export const enqueuePortfolioSnapshotManualJob = (
  job: PortfolioSnapshotManualJobPayload,
  deps: { enqueue: Enqueue; singletonKey?: string },
) => deps.enqueue.send(PORTFOLIO_SNAPSHOT_MANUAL_QUEUE, job, { singletonKey: deps.singletonKey ?? job.correlationId });
import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

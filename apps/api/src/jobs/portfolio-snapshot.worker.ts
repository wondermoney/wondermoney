import type { Job } from 'pg-boss';

import { DI } from '@app/database/di';
import {
  enqueuePortfolioSnapshotAutoContinuation,
  type PortfolioSnapshotAutoJobPayload,
  type PortfolioSnapshotManualJobPayload,
} from '@app/jobs/portfolio-snapshot.queue';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Portfolio } from '@entity/Portfolio';
import backgroundOperationService from '@service/operations/background-operation.service';
import portfolioSnapshotService from '@service/portfolio/portfolio-snapshot.service';
import { createWorkerEnqueueAdapter, type PartialBossLike } from '@service/queue/enqueue';

interface BgDeps { attachQueueJob?: (correlationId: string, queueJobId: string) => Promise<boolean>; claimJobStart: (correlationId: string, queueJobId: string) => Promise<boolean>; createQueuedOperation: (input: { correlationId: string; operationType: string; resourceId: string; retryable?: boolean }) => Promise<unknown>; finishJob: (correlationId: string, queueJobId: string, input: { retryable?: boolean; stage?: string; status: BackgroundOperationStatus }) => Promise<boolean>; heartbeatJob: (correlationId: string, queueJobId: string, input: { progress?: Record<string, unknown>; stage?: string }) => Promise<boolean>; }

const OPERATION_TYPE = 'portfolio.snapshot';

/**
 * Portfolios snapshotted per job. The sweep used to load every portfolio in the
 * system into memory and process them serially inside one 900 s pg-boss job, with
 * `retryLimit: 0` — so past some portfolio count the job expired mid-run and every
 * portfolio after that point silently lost that day's snapshot. Snapshots are
 * date-keyed, so tomorrow's run does not backfill: the gap is permanent.
 */
const PAGE_SIZE = 200;
/**
 * One heartbeat UPDATE per portfolio was a write amplification of 1:1 on a job whose
 * actual work is already write-heavy. Batching it keeps the liveness signal (the
 * recovery sweep's staleness cutoff is minutes, not seconds) at a fraction of the cost.
 */
const HEARTBEAT_EVERY = 25;

interface AutoDeps {
  backgroundOperationService?: BgDeps;
  boss?: Pick<PartialBossLike, 'send' | 'sendAfter'>;
  pageSize?: number;
  portfolioSnapshotService?: typeof portfolioSnapshotService;
}

function isDuplicate(error: unknown) { const m = String(error instanceof Error ? error.message : error).toLowerCase(); return m.includes('unique') || m.includes('duplicate') || m.includes('constraint'); }

const readCursor = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
};

export const handlePortfolioSnapshotAutoJob = async (job: Job<PortfolioSnapshotAutoJobPayload>, deps: AutoDeps = {}) => {
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const cursor = readCursor(job.data.cursor);
  // The correlation id carries the cursor so each page is its own operation rather
  // than every page fighting over one row's claim.
  const correlationId = job.data.correlationId ?? `portfolio.snapshot.auto:${job.id}`;
  const pageSize = Math.min(Math.max(deps.pageSize ?? PAGE_SIZE, 1), 1_000);
  try { await bg.createQueuedOperation({ correlationId, operationType: OPERATION_TYPE, resourceId: `portfolio-snapshot:auto:cursor:${cursor}`, retryable: false }); } catch (error) { if (!isDuplicate(error)) throw error; }
  if (!(await bg.claimJobStart(correlationId, job.id))) return false;
  if (bg.attachQueueJob) await bg.attachQueueJob(correlationId, job.id);
  try {
    const portfolios = await DI.em.find(
      Portfolio,
      { deletedAt: undefined, excluded: false, portfolioKey: { $gt: cursor } },
      { limit: pageSize, orderBy: { portfolioKey: 'asc' } },
    );
    let processed = 0;
    let nextCursor = cursor;
    for (const portfolio of portfolios) {
      await (deps.portfolioSnapshotService ?? portfolioSnapshotService).updateSnapshotForToday(portfolio.portfolioKey);
      processed += 1;
      nextCursor = portfolio.portfolioKey;
      if (processed % HEARTBEAT_EVERY === 0) {
        await bg.heartbeatJob(correlationId, job.id, { progress: { cursor: nextCursor, processed, total: portfolios.length }, stage: 'portfolio.snapshot:auto:running' });
      }
    }
    // A full page means there is very likely another one. Chaining a continuation job
    // keeps every individual job inside its `expireInSeconds` budget, and means a
    // failure loses one page rather than the rest of the night.
    const continued = portfolios.length >= pageSize;
    if (continued && deps.boss) {
      await enqueuePortfolioSnapshotAutoContinuation({ enqueue: createWorkerEnqueueAdapter(deps.boss) }, { correlationId: `portfolio.snapshot.auto:cursor:${nextCursor}`, cursor: nextCursor });
    }
    await bg.heartbeatJob(correlationId, job.id, { progress: { continued, cursor: nextCursor, processed }, stage: 'portfolio.snapshot:auto:page-complete' });
    return await finish(bg, correlationId, job.id, BackgroundOperationStatus.SUCCEEDED, false, 'portfolio.snapshot:auto:completed');
  } catch (error) {
    await finish(bg, correlationId, job.id, BackgroundOperationStatus.FAILED, false, 'portfolio.snapshot:auto:failed');
    throw error;
  }
};

export const handlePortfolioSnapshotManualJob = async (job: Job<PortfolioSnapshotManualJobPayload>, deps: { backgroundOperationService?: BgDeps; portfolioSnapshotService?: typeof portfolioSnapshotService } = {}) => {
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const { correlationId, portfolioId } = job.data;
  try { await bg.createQueuedOperation({ correlationId, operationType: OPERATION_TYPE, resourceId: `portfolio:${portfolioId}`, retryable: false }); } catch (error) { if (!isDuplicate(error)) throw error; }
  if (!(await bg.claimJobStart(correlationId, job.id))) return false;
  if (bg.attachQueueJob) await bg.attachQueueJob(correlationId, job.id);
  try {
    await bg.heartbeatJob(correlationId, job.id, { stage: 'portfolio.snapshot:manual:running' });
    await (deps.portfolioSnapshotService ?? portfolioSnapshotService).backfillSnapshotsForPortfolio(portfolioId);
    return await finish(bg, correlationId, job.id, BackgroundOperationStatus.SUCCEEDED, false, 'portfolio.snapshot:manual:completed');
  } catch (error) {
    await finish(bg, correlationId, job.id, BackgroundOperationStatus.FAILED, false, 'portfolio.snapshot:manual:failed');
    throw error;
  }
};

async function finish(bg: BgDeps, correlationId: string, queueJobId: string, status: BackgroundOperationStatus, retryable: boolean, stage: string) { const finished = await bg.finishJob(correlationId, queueJobId, { retryable, stage, status }); if (!finished) throw new Error('portfolio snapshot job failed to finish'); return true; }

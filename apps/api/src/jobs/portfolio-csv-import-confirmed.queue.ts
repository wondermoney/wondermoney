import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE = 'portfolio.csv-import-confirmed';
// A confirmed import writes every parsed row, so it gets a longer budget than the preview.
const PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE_OPTIONS = { expireInSeconds: 1_800, policy: 'exclusive', retryLimit: 0 } as const;

export interface PortfolioCsvImportConfirmedJobPayload {
  correlationId: string;
  importSessionId: number;
}

const assertValidImportSessionId = (importSessionId: number) => {
  if (!Number.isSafeInteger(importSessionId) || importSessionId <= 0) {
    throw new Error('portfolioCsvImportConfirmedSingletonKey requires a positive safe integer importSessionId');
  }
};

const portfolioCsvImportConfirmedSingletonKey = (importSessionId: number) => {
  assertValidImportSessionId(importSessionId);
  return `portfolio.csv-import-confirmed:${importSessionId}`;
};

export const ensurePortfolioCsvImportConfirmedQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE, PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE_OPTIONS);

export const enqueuePortfolioCsvImportConfirmedJob = async (
  job: PortfolioCsvImportConfirmedJobPayload,
  deps: { enqueue: Enqueue },
) => deps.enqueue.send(PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE, job, { singletonKey: portfolioCsvImportConfirmedSingletonKey(job.importSessionId) });

QUEUE_REGISTRY.set(PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE, { ensure: (boss) => ensurePortfolioCsvImportConfirmedQueue(boss), name: PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE });

import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE = 'portfolio.csv-parse-preview';
// Parse-only, and a user is watching a spinner: five minutes is already generous.
const PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE_OPTIONS = { expireInSeconds: 300, policy: 'exclusive', retryDelay: 5, retryLimit: 3 } as const;

export interface PortfolioCsvParsePreviewJobPayload {
  correlationId: string;
  importSessionId: number;
}

interface PortfolioCsvParsePreviewBoss {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
  updateQueue?: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}

export const ensurePortfolioCsvParsePreviewQueue = async (boss: PortfolioCsvParsePreviewBoss) => {
  await boss.createQueue(PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE, PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE_OPTIONS);

  // pg-boss updateQueue can drift retry settings on existing queues, but cannot change policy after creation.
  await boss.updateQueue?.(PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE, {
    retryDelay: PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE_OPTIONS.retryDelay,
    retryLimit: PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE_OPTIONS.retryLimit,
  });
};

export const enqueuePortfolioCsvParsePreviewJob = async (
  job: PortfolioCsvParsePreviewJobPayload,
  deps: { enqueue: Enqueue },
) =>
  deps.enqueue.send(PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE, job, { singletonKey: `portfolio.csv-parse-preview:${job.importSessionId}` });

QUEUE_REGISTRY.set(PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE, { ensure: (boss) => ensurePortfolioCsvParsePreviewQueue(boss), name: PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE });

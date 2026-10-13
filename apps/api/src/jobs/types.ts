import type { BackgroundOperationStatus } from '@entity/BackgroundOperation';

/**
 * The background-operation seam a worker handler may receive from `createWorker`.
 *
 * The concrete `backgroundOperationService` satisfies this interface, and the seam
 * itself is deliberately declared here so the composition root can resolve the
 * injected override once and hand it to every handler without casting it to `never`.
 * Handlers narrow this further to the subset of methods they actually call.
 */
export interface BackgroundOperationServiceDeps {
  attachQueueJob: (correlationId: string, queueJobId: string) => Promise<boolean>;
  claimJobStart: (correlationId: string, queueJobId: string) => Promise<boolean>;
  createQueuedOperation: (input: {
    correlationId: string;
    operationType: string;
    resourceId: string;
    retryable?: boolean;
  }) => Promise<unknown>;
  finishJob: (
    correlationId: string,
    queueJobId: string,
    input: { errorCode?: string; retryable?: boolean; stage?: string; status: BackgroundOperationStatus },
  ) => Promise<boolean>;
  heartbeatJob: (
    correlationId: string,
    queueJobId: string,
    input: { progress?: Record<string, unknown>; stage?: string },
  ) => Promise<boolean>;
  markAttemptFailedForRetry: (
    correlationId: string,
    queueJobId: string,
    input: { errorCode?: string; stage?: string },
  ) => Promise<boolean>;
}

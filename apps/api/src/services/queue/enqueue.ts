import { RequestEnqueueAdapter, type RequestEnqueueAdapterDeps } from './adapters/request-enqueue';
import { type PartialBossLike, WorkerEnqueueAdapter } from './adapters/worker-enqueue';
import type { QueueName } from './queues';

/** Options a producer may attach to a single enqueue. A subset of pg-boss `SendOptions`. */
export interface EnqueueOptions {
  expireInSeconds?: number;
  retentionSeconds?: number;
  retryBackoff?: boolean;
  retryDelay?: number;
  retryLimit?: number;
  singletonKey?: string;
}

/** Caller-side deadline; never forwarded to pg-boss. */
export interface EnqueueExecutionOptions {
  timeoutMs?: number;
}

/**
 * The enqueue seam.
 *
 * Every function that hands work to pg-boss takes an `Enqueue` instead of owning a boss. That keeps
 * production code on the same call shape as tests, which inject a `{ send, sendAfter }` stub.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- The generic is the seam's contract: a caller passes its own payload interface and gets it checked at the call site. A non-generic `unknown` parameter would erase that at every producer. */
export interface Enqueue {
  send<TPayload>(queue: QueueName, payload: TPayload, opts?: EnqueueOptions, execution?: EnqueueExecutionOptions): Promise<unknown>;
  sendAfter<TPayload>(queue: QueueName, payload: TPayload, opts: EnqueueOptions | undefined, scheduledFor: Date, execution?: EnqueueExecutionOptions): Promise<unknown>;
}
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

export type { PartialBossLike } from './adapters/worker-enqueue';

export type { QueueName };

/** Wraps an already-started pg-boss instance (or a partial boss that only has `send`/`sendAfter`). */
export const createWorkerEnqueueAdapter = (boss: PartialBossLike): Enqueue => new WorkerEnqueueAdapter(boss);

/** Builds a per-request adapter that owns the full create/start/ensure/send/stop lifecycle. */
export const createRequestEnqueueAdapter = (deps: RequestEnqueueAdapterDeps): Enqueue => new RequestEnqueueAdapter(deps);

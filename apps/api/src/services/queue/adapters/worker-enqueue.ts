import logger from '@utils/logger';

import type { Enqueue, EnqueueExecutionOptions, EnqueueOptions } from '../enqueue';
import type { QueueName } from '../queues';

/** pg-boss accepts `object | null`; validate at the seam boundary. */
const asJobData = (payload: unknown): null | object => {
  if (payload === null || typeof payload === 'object') return payload;
  throw new TypeError('WorkerEnqueueAdapter: job payload must be an object or null');
};

export interface PartialBossLike {
  send?: (queue: string, data: null | object, options?: EnqueueOptions) => Promise<unknown>;
  sendAfter?: (queue: string, data: null | object, options: EnqueueOptions | null, scheduledFor: Date) => Promise<unknown>;
}

const validateTimeout = (execution?: EnqueueExecutionOptions): number | undefined => {
  const timeoutMs = execution?.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError('Enqueue timeoutMs must be a finite positive number');
  }
  return timeoutMs;
};

const withDeadline = <T>(operation: Promise<T>, timeoutMs: number | undefined): Promise<T> => {
  if (timeoutMs === undefined) return operation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadlineWon = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      deadlineWon = true;
      const error = new Error(`Queue enqueue exceeded its ${timeoutMs}ms deadline`);
      error.name = 'EnqueueTimeoutError';
      reject(error);
    }, timeoutMs);
  });
  // Keep an observer on borrowed-client work after the caller deadline; never alter its lifecycle.
  void operation.catch((error: unknown) => {
    if (!deadlineWon) return;
    try { logger.warn({ error }, 'Worker enqueue rejected after caller deadline'); } catch { /* no-op */ }
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

export class WorkerEnqueueAdapter implements Enqueue {
  public constructor(private readonly boss: PartialBossLike) {}

  public send(queue: QueueName, payload: unknown, opts?: EnqueueOptions, execution?: EnqueueExecutionOptions): Promise<unknown> {
    const timeoutMs = validateTimeout(execution);
    const send = this.boss.send;
    if (!send) throw new Error('WorkerEnqueueAdapter: boss.send is not available');
    return withDeadline(Promise.resolve().then(() => send.call(this.boss, queue, asJobData(payload), opts)), timeoutMs);
  }

  public sendAfter(
    queue: QueueName,
    payload: unknown,
    opts: EnqueueOptions | undefined,
    scheduledFor: Date,
    execution?: EnqueueExecutionOptions,
  ): Promise<unknown> {
    const timeoutMs = validateTimeout(execution);
    const sendAfter = this.boss.sendAfter;
    if (!sendAfter) throw new Error('WorkerEnqueueAdapter: boss.sendAfter is not available');
    return withDeadline(Promise.resolve().then(() => sendAfter.call(this.boss, queue, asJobData(payload), opts ?? null, scheduledFor)), timeoutMs);
  }
}

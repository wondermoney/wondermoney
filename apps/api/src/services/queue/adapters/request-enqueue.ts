import logger from '@utils/logger';

import type { Enqueue, EnqueueExecutionOptions, EnqueueOptions } from '../enqueue';
import { createOwnedProducerRuntime, type OwnedProducerRuntime } from '../owned-producer-runtime';
import { ensureQueue, type QueueName } from '../queues';

/** pg-boss accepts `object | null`; validate at the seam boundary. */
const asJobData = (payload: unknown): null | object => {
  if (payload === null || typeof payload === 'object') return payload;
  throw new TypeError('RequestEnqueueAdapter: job payload must be an object or null');
};

export interface RequestEnqueueAdapterDeps {
  /** Called per invocation, after timeout validation; construction is lazy until an enqueue. */
  createRuntime?: () => OwnedProducerRuntime;
}

const timeoutError = (timeoutMs: number): Error => {
  const error = new Error(`Queue enqueue exceeded its ${timeoutMs}ms deadline`);
  error.name = 'EnqueueTimeoutError';
  return error;
};

const reportCleanupFailure = (error: unknown): void => {
  try {
    logger.error({ error }, 'Request enqueue runtime cleanup failed');
  } catch {
    // Cleanup diagnostics must not alter enqueue outcomes.
  }
};

const disposeObserved = (runtime: OwnedProducerRuntime, reason?: Error): void => {
  try {
    void Promise.resolve(runtime.dispose(reason)).catch(reportCleanupFailure);
  } catch (error) {
    reportCleanupFailure(error);
  }
};

export class RequestEnqueueAdapter implements Enqueue {
  private readonly ensured = new Set<QueueName>();

  public constructor(private readonly deps: RequestEnqueueAdapterDeps = {}) {}

  public send(queue: QueueName, payload: unknown, opts?: EnqueueOptions, execution?: EnqueueExecutionOptions): Promise<unknown> {
    return this.withRuntime(execution, async (runtime, checkExpired) => {
      await this.ensureOnce(runtime, queue, checkExpired);
      checkExpired();
      const result: unknown = await runtime.boss.send(queue, asJobData(payload), opts);
      return result;
    });
  }

  public sendAfter(
    queue: QueueName,
    payload: unknown,
    opts: EnqueueOptions | undefined,
    scheduledFor: Date,
    execution?: EnqueueExecutionOptions,
  ): Promise<unknown> {
    return this.withRuntime(execution, async (runtime, checkExpired) => {
      await this.ensureOnce(runtime, queue, checkExpired);
      checkExpired();
      const result: unknown = await runtime.boss.sendAfter(queue, asJobData(payload), opts ?? null, scheduledFor);
      return result;
    });
  }

  private async ensureOnce(runtime: OwnedProducerRuntime, queue: QueueName, checkExpired: () => void): Promise<void> {
    if (this.ensured.has(queue)) return;
    await ensureQueue(runtime.boss, queue);
    checkExpired();
    this.ensured.add(queue);
  }

  private async withRuntime<Result>(
    execution: EnqueueExecutionOptions | undefined,
    run: (runtime: OwnedProducerRuntime, checkExpired: () => void) => Promise<Result>,
  ): Promise<Result> {
    const timeoutMs = execution?.timeoutMs;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new RangeError('Enqueue timeoutMs must be a finite positive number');
    }

    const invocationStartedAt = Date.now();
    const runtime = (this.deps.createRuntime ?? createOwnedProducerRuntime)();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeoutReject!: (error: Error) => void;
    const timedOut = new Promise<never>((_resolve, reject) => { timeoutReject = reject; });
    // Always have a rejection observer; the race below is installed synchronously.
    void timedOut.catch(() => undefined);
    const expire = (): void => {
      if (expired) return;
      expired = true;
      const error = timeoutError(timeoutMs ?? 0);
      timeoutReject(error);
      disposeObserved(runtime, error);
    };
    const checkExpired = (): void => {
      if (!expired && timeoutMs !== undefined && Date.now() - invocationStartedAt >= timeoutMs) expire();
      if (expired) throw timeoutError(timeoutMs ?? 0);
    };
    if (timeoutMs !== undefined) {
      const remainingMs = Math.max(0, timeoutMs - (Date.now() - invocationStartedAt));
      if (remainingMs === 0) expire();
      else timer = setTimeout(expire, remainingMs);
    }

    const operation = (async () => {
      checkExpired();
      await runtime.start();
      checkExpired();
      return run(runtime, checkExpired);
    })();

    try {
      if (timeoutMs !== undefined) {
        const result = await Promise.race([operation, timedOut]);
        // Acceptance wins the race: don't let cleanup become part of the caller deadline.
        clearTimeout(timer);
        timer = undefined;
        disposeObserved(runtime);
        return result;
      }
      const result = await operation;
      disposeObserved(runtime);
      return result;
    } catch (error) {
      if (timer !== undefined) clearTimeout(timer);
      // Timeout already initiated disposal without awaiting potentially slow cleanup.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Set asynchronously by the deadline callback.
      if (!expired) {
        const reason = error instanceof Error ? error : new Error(String(error));
        if (timeoutMs !== undefined) {
          disposeObserved(runtime, reason);
        } else {
          try { await runtime.dispose(reason); } catch (cleanupError) { reportCleanupFailure(cleanupError); }
        }
      }
      throw error;
    }
  }
}

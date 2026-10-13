import * as Sentry from '@sentry/node';

/**
 * Sentry instrumentation for pg-boss handlers.
 *
 * === Why this exists ===
 *
 * `boss.on('error', ...)` fires for pg-boss *internal* errors (maintenance,
 * connection loss) — it does **not** fire when a handler rejects. pg-boss
 * catches a thrown handler itself, moves the job to `retry` and then `failed`,
 * and nothing reaches Sentry. That is how a queue can fail every single job for
 * days with no alert: the only trace is a `logger.error` line in the container
 * log tab.
 *
 * Wrapping every `boss.work()` handler in `instrumentedBatch` turns that silence
 * into an event, while preserving pg-boss's retry semantics exactly — the error
 * is always rethrown after capture.
 *
 * === What is safe to send ===
 *
 * Job payloads on this system carry email addresses, tenant identifiers and
 * financial amounts. **The payload is never sent.** Only the payload's *keys* go
 * out, plus the three fields that are already non-sensitive correlation handles
 * (`correlationId`, `tenantKey`, `appuserKey`) and pg-boss's own `retryCount`.
 */

/** The minimum surface `instrumentedBatch` needs from a pg-boss job. */
export interface InstrumentedJob {
  data?: unknown;
  id: string;
}

const MAX_PAYLOAD_KEYS = 40;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Payload key names only — never their values. Bounded so a pathological payload can't bloat the event. */
export const payloadKeys = (data: unknown): string[] => {
  const record = asRecord(data);
  if (!record) return [];
  return Object.keys(record).slice(0, MAX_PAYLOAD_KEYS);
};

const scalarTag = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0 && value.length <= 255) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

/** pg-boss only exposes `retryCount` when the queue is worked with `includeMetadata: true`. */
const retryCountOf = (job: InstrumentedJob): number | undefined => {
  const value = (job as { retryCount?: unknown }).retryCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/**
 * Captures a handler failure to Sentry with queue/job correlation context.
 * Never throws: telemetry must not be able to change a job's outcome.
 */
export function captureJobFailure(queue: string, job: InstrumentedJob, error: unknown): void {
  try {
    const record = asRecord(job.data) ?? {};
    const retryCount = retryCountOf(job);
    const tags: Record<string, string> = { queue };
    if (job.id) tags['jobId'] = job.id;
    const correlationId = scalarTag(record['correlationId']);
    if (correlationId) tags['correlationId'] = correlationId;
    const tenantKey = scalarTag(record['tenantKey']);
    if (tenantKey) tags['tenantKey'] = tenantKey;
    if (retryCount !== undefined) tags['retryCount'] = String(retryCount);

    Sentry.captureException(error, {
      // Group by queue rather than by stack, so "this queue is failing" is one
      // issue instead of one issue per distinct throw site.
      extra: {
        appuserKey: scalarTag(record['appuserKey']),
        payloadKeys: payloadKeys(job.data),
        queue,
        retryCount,
      },
      fingerprint: ['pgboss-handler', queue],
      tags,
    });
  } catch {
    // Swallowed deliberately — see the docblock.
  }
}

/**
 * Wraps a single-job handler into the batch callback shape `boss.work()` expects,
 * capturing any rejection to Sentry before rethrowing so pg-boss still retries
 * and dead-letters exactly as it would have.
 */
export const instrumentedBatch = <TJob extends InstrumentedJob>(
  queue: string,
  run: (job: TJob) => Promise<unknown>,
): ((jobs: TJob[]) => Promise<{ ok: true }>) => async (jobs: TJob[]) => {
  for (const job of jobs) {
    try {
      await run(job);
    } catch (error) {
      captureJobFailure(queue, job, error);
      throw error;
    }
  }

  return { ok: true };
};

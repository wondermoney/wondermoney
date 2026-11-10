import type { Logger } from 'pino';

import { INSTANCE_HEARTBEAT_QUEUE } from '@app/jobs/instance-heartbeat.queue';
import { backlogThresholdSeconds, resolvePgBossSchema } from '@app/jobs/queue-depth-monitor.worker';
import { buildInfo } from '@utils/constants';
import logger from '@utils/logger';

/**
 * Readiness: can this instance do its work right now? Unlike the liveness check
 * (`GET /v1/health`, which only proves the API process answers), it asks Postgres three things,
 * in parallel and each within a timeout:
 *
 * - `database`: does `select 1` come back?
 * - `queue`: can the pg-boss job table be read, and has no job waited too long to start?
 * - `worker`: did the worker finish its `instance.heartbeat` job in the last 15 minutes?
 *
 * The report is public, so a failure carries only a fixed reason. Driver errors, which can name
 * hosts, ports and users, go to the log.
 */

export type CheckResult = { reason: ReadinessFailure; status: 'fail' } | { status: 'ok' };

export type QueueCheck = CheckResult | { reason: 'backlog'; stalledQueues: number; status: 'fail' };

export interface ReadinessDeps {
  env?: NodeJS.ProcessEnv;
  execute: (sql: string) => Promise<unknown>;
  logger?: Pick<Logger, 'warn'>;
  now?: () => Date;
  timeoutMs?: number;
}

export type ReadinessFailure = 'backlog' | 'no_heartbeat' | 'stale_heartbeat' | 'timeout' | 'unavailable' | 'unreachable';

export interface ReadinessReport {
  checks: { database: CheckResult; queue: QueueCheck; worker: WorkerCheck };
  commit: null | string;
  status: 'degraded' | 'ok';
  version: string;
}

export type WorkerCheck =
  | { lastHeartbeatAt: null | string; reason: 'no_heartbeat' | 'stale_heartbeat'; status: 'fail' }
  | { lastHeartbeatAt: string; status: 'ok' }
  | { reason: ReadinessFailure; status: 'fail' };

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_JOB_AGE_MINUTES = 60;
/** The heartbeat runs every 5 minutes, so 15 minutes is three missed runs. */
const WORKER_STALE_AFTER_MS = 15 * 60_000;

class CheckTimeout extends Error {}

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  // The losing query may still settle later; keep that from becoming an unhandled rejection.
  work.catch(() => {
    // Already handled by the race below.
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new CheckTimeout()); }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const maxJobAgeSeconds = (env: NodeJS.ProcessEnv): number => {
  const minutes = Number(env['HEALTH_MAX_JOB_AGE_MINUTES']);
  return (Number.isInteger(minutes) && minutes > 0 ? minutes : DEFAULT_MAX_JOB_AGE_MINUTES) * 60;
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result) ? result.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null) : [];

export async function checkReadiness(deps: ReadinessDeps): Promise<ReadinessReport> {
  const env = deps.env ?? process.env;
  const log = deps.logger ?? logger;
  const now = (deps.now ?? (() => new Date()))();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Runs one probe; any error becomes a fixed reason, and its detail goes to the log only. */
  const probe = async <T extends { status: string }>(
    check: 'database' | 'queue' | 'worker',
    onError: ReadinessFailure,
    run: () => Promise<T>,
  ): Promise<T | { reason: ReadinessFailure; status: 'fail' }> => {
    try {
      return await withTimeout(run(), timeoutMs);
    } catch (error) {
      const reason = error instanceof CheckTimeout ? 'timeout' : onError;
      log.warn({ check, error, reason }, 'Readiness check failed');
      return { reason, status: 'fail' };
    }
  };

  const database = probe('database', 'unreachable', async () => {
    await deps.execute('select 1');
    return { status: 'ok' as const };
  });

  const queue = probe('queue', 'unavailable', async (): Promise<QueueCheck> => {
    const schema = resolvePgBossSchema(env);
    // Measured from `start_after`, when a job became due, so deferred and backing-off jobs do
    // not count as waiting before their time.
    const rows = rowsOf(await deps.execute(
      `select "name", min("start_after") as "oldest_start_after"
         from "${schema}"."job"
        where "state" in ('created', 'retry') and "start_after" <= now()
        group by "name"`,
    ));
    const globalMax = maxJobAgeSeconds(env);
    const stalled = rows.filter((row) => {
      const oldest = toDate(row['oldest_start_after']);
      if (!oldest || typeof row['name'] !== 'string') return false;
      // Some queues back up for hours by design (per-user email batches); they keep their own,
      // longer allowance from the queue-depth monitor.
      const allowed = Math.max(globalMax, backlogThresholdSeconds(row['name']));
      return (now.getTime() - oldest.getTime()) / 1_000 > allowed;
    });
    return stalled.length === 0 ? { status: 'ok' } : { reason: 'backlog', stalledQueues: stalled.length, status: 'fail' };
  });

  const worker = probe('worker', 'unavailable', async (): Promise<WorkerCheck> => {
    const schema = resolvePgBossSchema(env);
    const [row] = rowsOf(await deps.execute(
      `select max("completed_on") as "last_completed_on"
         from "${schema}"."job"
        where "name" = '${INSTANCE_HEARTBEAT_QUEUE}' and "state" = 'completed'`,
    ));
    const last = toDate(row?.['last_completed_on']);
    if (!last) return { lastHeartbeatAt: null, reason: 'no_heartbeat', status: 'fail' };
    const lastHeartbeatAt = last.toISOString();
    if (now.getTime() - last.getTime() > WORKER_STALE_AFTER_MS) {
      return { lastHeartbeatAt, reason: 'stale_heartbeat', status: 'fail' };
    }
    return { lastHeartbeatAt, status: 'ok' };
  });

  const checks = { database: await database, queue: await queue, worker: await worker };
  const healthy = Object.values(checks).every((check) => check.status === 'ok');
  return { checks, status: healthy ? 'ok' : 'degraded', ...buildInfo() };
}

import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { TRANSACTION_ENRICHMENT_GPT_DLQ } from '@app/jobs/transaction-enrichment.queue';
import logger from '@utils/logger';

/**
 * Queue-depth / oldest-pending-job monitor.
 *
 * === Why this is the load-bearing check ===
 *
 * Every other liveness signal on this worker answers a different question than
 * "is this queue draining?":
 *
 * - `/health` proves the Node event loop is alive (and, since the status hook was
 *   wired, that pg-boss started and Postgres answers) — but not that any queue is
 *   making progress.
 * - The HetrixTools heartbeat runs *as a pg-boss job*, which proves that **a**
 *   queue drains. Every queue has its own `batchSize: 1` execution slot, so a
 *   handler wedged on a socket with no timeout freezes exactly one queue while
 *   `worker.heartbeat` keeps pinging green.
 * - Sentry cron monitors prove a *schedule* still fires; they say nothing about
 *   event-driven queues (bank sync, CSV imports, lifecycle email, enrichment).
 *
 * This job closes that gap by asking Postgres directly: for every queue, how many
 * jobs are waiting, and how old is the oldest one? A queue that stopped draining
 * — hung provider call, poisoned handler, consumer never registered, worker
 * container down — shows up here within one tick, whatever the cause.
 *
 * === Why per-queue thresholds ===
 *
 * A uniform threshold is useless here. `account.initial-sync` legitimately queues
 * behind a 365-day transaction pull; `portfolio.csv-parse-preview` is a user
 * staring at a spinner. One global number is either too noisy to keep or too slack
 * to catch anything.
 */

/** Seconds a `created`/`retry` job may wait before the queue counts as stalled. */
const DEFAULT_BACKLOG_AGE_SECONDS = 1_800;

export const QUEUE_BACKLOG_AGE_SECONDS: Readonly<Record<string, number>> = {
  // Once-a-minute drain of an outbox table. A 10-minute-old row means the tick died.
  'analytics.outbox': 600,
  // A 365-day provider pull per job, one slot, fanned out per requisition.
  'account.auto-sync.requisition': 7_200,
  'account.auto-sync.schedule': 1_800,
  'account.initial-sync': 7_200,
  // User-facing: someone is watching a progress bar.
  'account.csv-import': 900,
  'portfolio.csv-import': 900,
  'portfolio.csv-import-confirmed': 900,
  'portfolio.csv-parse-preview': 600,
  // Daily/weekday crons: a backlog older than an hour means the run is wedged,
  // not merely slow.
  'asset-price.historical-backfill': 7_200,
  'asset-price.refresh': 3_600,
  'certificado-aforro.rate-sync': 3_600,
  'exchange-rate.refresh': 3_600,
  'lifecycle.cron': 3_600,
  'portfolio.snapshot.auto': 7_200,
  // Email delivery: fan-out pages queue deliberately and drain over hours.
  'bank-recovery.send': 10_800,
  'email.budget.user': 21_600,
  'email.monthly_story.user': 21_600,
  'email.weekly.user': 21_600,
  'lifecycle.send': 10_800,
  // Highest-volume queue in the system; a deep-but-moving backlog is normal.
  'transaction.enrichment.gpt': 7_200,
  // The monitor itself, and the reconciler that watches everything else.
  'background-operation.recovery': 1_800,
  'queue-depth.monitor': 900,
  // Any job at all in a dead-letter queue is already a failure; see DLQ handling below.
  [TRANSACTION_ENRICHMENT_GPT_DLQ]: 0,
};

/** Waiting states. `active` is excluded on purpose — a long-running job is not a backlog. */
const WAITING_STATES = ['created', 'retry'] as const;

export interface QueueDepthRow {
  count: number;
  name: string;
  oldestCreatedOn: Date | null;
  state: string;
}

export interface QueueDepthSummary {
  queues: number;
  stalled: StalledQueue[];
  totalWaiting: number;
}

export interface StalledQueue {
  ageSeconds: number;
  count: number;
  name: string;
  state: string;
  thresholdSeconds: number;
}

interface QueueDepthDeps {
  execute?: (sql: string) => Promise<unknown>;
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  now?: () => Date;
  schema?: string;
}

/**
 * pg-boss's schema name is interpolated into the query (it cannot be a bind
 * parameter), so it is validated as a bare identifier first. The value comes from
 * `PGBOSS_SCHEMA`, i.e. from our own deploy config rather than from a request —
 * but a config value reaching a SQL string unchecked is exactly the shape of bug
 * that stops being theoretical the day someone templates it from somewhere else.
 */
const SAFE_IDENTIFIER = /^[a-z_]\w*$/iu;

export const resolvePgBossSchema = (env: NodeJS.ProcessEnv = process.env): string => {
  const schema = env['PGBOSS_SCHEMA'] ?? 'pgboss';
  if (!SAFE_IDENTIFIER.test(schema)) throw new Error(`Invalid PGBOSS_SCHEMA value: ${schema}`);
  return schema;
};

export const backlogThresholdSeconds = (queue: string): number =>
  QUEUE_BACKLOG_AGE_SECONDS[queue] ?? DEFAULT_BACKLOG_AGE_SECONDS;

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const toCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRows = (rows: unknown): QueueDepthRow[] => {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;
    const name = record['name'];
    const state = record['state'];
    if (typeof name !== 'string' || typeof state !== 'string') return [];
    return [{ count: toCount(record['count']), name, oldestCreatedOn: toDate(record['oldest_created_on']), state }];
  });
};

/**
 * Reports one Sentry event per stalled queue, fingerprinted on the queue+state so
 * a queue that stays stuck across ticks stays a single issue instead of opening a
 * new one every five minutes.
 */
const report = (stalled: StalledQueue): void => {
  try {
    Sentry.captureMessage(`Queue backlog: ${stalled.name} has a ${stalled.state} job ${Math.round(stalled.ageSeconds)}s old`, {
      extra: {
        ageSeconds: Math.round(stalled.ageSeconds),
        count: stalled.count,
        queue: stalled.name,
        state: stalled.state,
        thresholdSeconds: stalled.thresholdSeconds,
      },
      fingerprint: ['queue-backlog', stalled.name, stalled.state],
      level: 'error',
      tags: { queue: stalled.name, state: stalled.state },
    });
  } catch {
    // Telemetry must never take the monitor down with it.
  }
};

/**
 * pg-boss job handler: aggregates `pgboss.job` by queue + state and raises a
 * Sentry event for every queue whose oldest waiting job is past that queue's
 * threshold. Read-only; it never mutates queue state.
 */
export async function handleQueueDepthMonitorJob(deps: QueueDepthDeps = {}): Promise<QueueDepthSummary> {
  const log = deps.logger ?? logger;
  const schema = deps.schema ?? resolvePgBossSchema();
  const now = (deps.now ?? (() => new Date()))();
  const execute = deps.execute ?? ((sql: string) => DI.em.getConnection().execute(sql));

  const rows = normalizeRows(await execute(
    `select "name", "state", count(*)::int as "count", min("created_on") as "oldest_created_on"
       from "${schema}"."job"
      where "state" in (${WAITING_STATES.map((state) => `'${state}'`).join(', ')})
      group by "name", "state"`,
  ));

  const stalled: StalledQueue[] = [];
  let totalWaiting = 0;
  for (const row of rows) {
    totalWaiting += row.count;
    if (!row.oldestCreatedOn) continue;
    const ageSeconds = (now.getTime() - row.oldestCreatedOn.getTime()) / 1_000;
    const thresholdSeconds = backlogThresholdSeconds(row.name);
    if (ageSeconds < thresholdSeconds) continue;
    stalled.push({ ageSeconds, count: row.count, name: row.name, state: row.state, thresholdSeconds });
  }

  for (const entry of stalled) {
    report(entry);
    log.error(
      { ageSeconds: Math.round(entry.ageSeconds), count: entry.count, queue: entry.name, state: entry.state, thresholdSeconds: entry.thresholdSeconds },
      'Queue backlog exceeded its threshold',
    );
  }

  const summary: QueueDepthSummary = { queues: rows.length, stalled, totalWaiting };
  log.info({ queues: summary.queues, stalled: stalled.length, totalWaiting }, 'Queue depth monitor completed');
  return summary;
}

import * as Sentry from '@sentry/node';

import logger from '@utils/logger';

/**
 * Per-job liveness for scheduled work, via Sentry Cron Monitors.
 *
 * === Why this exists alongside the HetrixTools heartbeat ===
 *
 * `worker-heartbeat.worker.ts` already pings an external dead-man's switch every
 * two minutes, and a successful ping proves a lot: the worker process is alive,
 * connected to Postgres, and actually pulling and executing queued jobs. What it
 * cannot prove is that any *particular* schedule is still in place. If a job's
 * `boss.schedule(...)` call stops running — a bad deploy, `PGBOSS_SCHEDULE`
 * unset on the scheduler owner, a dropped `pgboss.schedule` row, a rename that
 * orphans the old queue — the heartbeat stays green while that one job silently
 * never runs again.
 *
 * That is the failure mode with no signal at all: every handled error in these
 * jobs raises a Sentry event, but a job that never starts raises nothing, and
 * silence is indistinguishable from success. Sentry inverts it — the monitor
 * alerts when an *expected* check-in fails to arrive.
 *
 * === Why 'ok' means "it ran", not "it succeeded" ===
 *
 * A run that completes and reports a business-level problem (IGCP hasn't
 * published this month, a cross-check disagreed) has already raised its own
 * Sentry event with far better context than a cron monitor could carry. Marking
 * those as check-in failures would double-alert and, worse, train people to
 * ignore the monitor. So the check-in tracks exactly one thing — did the handler
 * run to completion — and only a thrown error marks it failed.
 *
 * The monitor is created/updated by the check-in itself (`monitorConfig` upsert),
 * so there is nothing to configure in the Sentry UI first.
 */
export interface CronMonitorOptions {
  /** Minutes late a check-in may be before the monitor is considered missed. */
  checkinMarginMinutes?: number;
  /** Minutes a run may take before it is considered stuck. */
  maxRuntimeMinutes?: number;
  /** Stable slug identifying the monitor in Sentry. Renaming it creates a new monitor. */
  monitorSlug: string;
  /** The same crontab string the job is scheduled with, so Sentry knows when to expect a check-in. */
  schedule: string;
  /**
   * The same `tz` the job is scheduled with. Defaults to UTC because that is what
   * almost every schedule in this repo uses — but the financial-email coordinators
   * are scheduled `Europe/Lisbon`, and a monitor told the wrong timezone alerts
   * spuriously for an hour twice a year.
   */
  timezone?: string;
}

const DEFAULT_CHECKIN_MARGIN_MINUTES = 60;
const DEFAULT_MAX_RUNTIME_MINUTES = 30;

/**
 * Wraps a scheduled job handler in a Sentry check-in pair. Never changes the
 * handler's result or swallows its errors — a monitoring wrapper that alters the
 * thing it monitors is worse than none.
 */
export async function withCronMonitor<T>(options: CronMonitorOptions, run: () => Promise<T>): Promise<T> {
  const monitorConfig = {
    checkinMargin: options.checkinMarginMinutes ?? DEFAULT_CHECKIN_MARGIN_MINUTES,
    maxRuntime: options.maxRuntimeMinutes ?? DEFAULT_MAX_RUNTIME_MINUTES,
    schedule: { type: 'crontab' as const, value: options.schedule },
    timezone: options.timezone ?? 'UTC',
  };

  let checkInId: string | undefined;
  try {
    checkInId = Sentry.captureCheckIn({ monitorSlug: options.monitorSlug, status: 'in_progress' }, monitorConfig);
  } catch (error) {
    // Telemetry must never take the job down with it.
    logger.warn({ error, monitorSlug: options.monitorSlug }, 'Cron monitor check-in failed to start');
  }

  const finish = (status: 'error' | 'ok') => {
    if (checkInId === undefined) return;
    try {
      Sentry.captureCheckIn({ checkInId, monitorSlug: options.monitorSlug, status });
    } catch (error) {
      logger.warn({ error, monitorSlug: options.monitorSlug, status }, 'Cron monitor check-in failed to close');
    }
  };

  try {
    const result = await run();
    finish('ok');
    return result;
  } catch (error) {
    finish('error');
    throw error;
  }
}

import type { Logger } from 'pino';

import { WORKER_HEARTBEAT_QUEUE } from '@app/jobs/worker-heartbeat.queue';
import logger from '@utils/logger';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface WorkerHeartbeatDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  timeoutMs?: number;
}

export interface WorkerHeartbeatResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
}

/**
 * Ping the external HetrixTools heartbeat URL (dead-man's switch). Running this
 * as a pg-boss scheduled job — rather than a bare timer — means a successful
 * ping proves the whole real path is healthy: worker process alive, connected to
 * Postgres, and actually pulling and executing queued jobs.
 *
 * Never throws: a failed ping must not retry (the next tick supersedes it), and
 * the monitor going DOWN after repeated silence is the intended alerting signal.
 */
export async function handleWorkerHeartbeatJob(deps: WorkerHeartbeatDeps = {}): Promise<WorkerHeartbeatResult> {
  const env = deps.env ?? process.env;
  const log = deps.logger ?? logger;
  const doFetch = deps.fetch ?? fetch;
  const url = env['HETRIX_WORKER_HEARTBEAT_URL']?.trim();

  if (!url) {
    log.warn({ queue: WORKER_HEARTBEAT_QUEUE }, 'HETRIX_WORKER_HEARTBEAT_URL not set; skipping worker heartbeat ping');
    return { ok: false, skipped: true };
  }

  try {
    const response = await doFetch(url, { signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    if (!response.ok) {
      log.warn({ queue: WORKER_HEARTBEAT_QUEUE, status: response.status }, 'Worker heartbeat ping returned non-OK status');
      return { ok: false, status: response.status };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    log.warn({ error, queue: WORKER_HEARTBEAT_QUEUE }, 'Worker heartbeat ping failed');
    return { ok: false };
  }
}

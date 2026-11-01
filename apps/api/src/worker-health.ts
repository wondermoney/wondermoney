import http from 'node:http';

/**
 * Health endpoint for the worker container.
 *
 * === Why the `status` hook is not optional in practice ===
 *
 * Without a `status` hook this endpoint answers `{ ok: true }` unconditionally. It consults
 * nothing — not pg-boss, not the ORM, not any job state — so it proves only that the Node
 * event loop is alive. Coolify's generated health check hits exactly this, which makes it
 * actively misleading: a worker whose pg-boss client failed to start, or whose database is
 * unreachable, reports healthy forever.
 *
 * A caller that passes `status` gets a real answer: `ok: false` on the payload **and**
 * HTTP 503, so an orchestrator restarts the container instead of leaving it green.
 *
 * This still cannot detect a single frozen *queue* — every queue has its own execution
 * slot, so the process can be perfectly healthy while one queue has stopped draining.
 * That is what `jobs/queue-depth-monitor.worker.ts` is for; the two are complementary.
 */
export interface WorkerHealthStatus extends Record<string, unknown> {
  ok: boolean;
}

interface WorkerHealthOptions {
  status?: () => Promise<WorkerHealthStatus> | WorkerHealthStatus;
}

type WorkerHealthPortEnv = Partial<Record<'APP_ENV' | 'DEPLOY_ENV' | 'NODE_ENV' | 'PORT' | 'WORKER_HEALTH_PORT', string | undefined>>;

const parsePort = (name: string, value: string | undefined, fallback: number) => {
  const port = Number(value);

  if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;

  if (value === undefined || value === '') return fallback;

  throw new Error(`Invalid ${name} value: ${value}`);
};

export function createWorkerHealthServer(options: WorkerHealthOptions = {}) {
  const server = http.createServer((req, res) => {
    const path = req.url ?? '';
    if (req.method === 'GET' && (path === '/health' || path === '/v1/health')) {
      void (async () => {
        let ok = true;
        let status: Record<string, unknown> = {};
        if (options.status) {
          try {
            const reported = await options.status();
            status = reported;
            ok = reported.ok;
          } catch (error) {
            // A health probe that throws is itself evidence of ill health, and must
            // never leave the request hanging.
            ok = false;
            status = { reason: error instanceof Error ? error.message : 'health_check_failed' };
          }
        }

        // `ok` is written last so a status object cannot contradict the computed verdict.
        const body = JSON.stringify({ service: 'worker', ...status, ok });
        res.statusCode = ok ? 200 : 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      })();
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  return {
    close: async () => new Promise<void>((resolve, reject) => {
      // Without this, a keep-alive connection from the orchestrator's own health agent
      // holds the server open and `close()` never resolves — so shutdown burns its whole
      // budget waiting on the thing that was checking whether we were alive.
      server.closeIdleConnections();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
      server.closeAllConnections();
    }),
    server,
    start: async (port: number) => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    }),
  };
}

export function resolveWorkerHealthPort(env: WorkerHealthPortEnv = process.env) {
  if (env.WORKER_HEALTH_PORT) return parsePort('WORKER_HEALTH_PORT', env.WORKER_HEALTH_PORT, 3002);

  const appEnv = env.APP_ENV ?? env.DEPLOY_ENV ?? env.NODE_ENV;
  if (appEnv === 'production' || appEnv === 'staging') return parsePort('PORT', env.PORT, 3001);

  return 3002;
}

export function startWorkerHealthServer(options: WorkerHealthOptions = {}, port = resolveWorkerHealthPort()) {
  const healthServer = createWorkerHealthServer(options);
  return healthServer.start(port).then(() => healthServer);
}

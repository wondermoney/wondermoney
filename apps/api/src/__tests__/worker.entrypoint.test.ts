import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn().mockResolvedValue(undefined);
const closeMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const startMock = vi.fn().mockResolvedValue(undefined);
const healthCloseMock = vi.fn().mockResolvedValue(undefined);
const startWorkerHealthServerMock = vi.fn().mockResolvedValue({
  close: healthCloseMock,
});
const infoMock = vi.fn();
const errorMock = vi.fn();
const setupGracefulShutdownMock = vi.fn();
const sentryCaptureExceptionMock = vi.fn();
const sentryCloseMock = vi.fn().mockResolvedValue(undefined);
const isRunningMock = vi.fn(() => true);
const dbExecuteMock = vi.fn().mockResolvedValue([]);
const { loadOrder } = vi.hoisted(() => ({ loadOrder: [] as string[] }));

// Sentry's instrumentation is initialised when `@service/sentry` loads, so the factory
// running is the observable outcome of "error reporting is on in the worker process".
vi.mock('@service/sentry', () => {
  loadOrder.push('sentry');
  return {};
});

vi.mock('@sentry/node', () => ({
  captureException: sentryCaptureExceptionMock,
  close: sentryCloseMock,
}));

vi.mock('@utils/logger', () => ({
  default: { error: errorMock, info: infoMock, warn: vi.fn() },
}));

vi.mock('@app/database/di', () => ({
  closeDatabase: closeMock,
  connectDatabase: connectMock,
  DI: { orm: { em: { getConnection: () => ({ execute: dbExecuteMock }) } } },
}));

vi.mock('@app/jobs/worker', () => ({
  createWorker: vi.fn(() => {
    loadOrder.push('createWorker');
    return { isRunning: isRunningMock, start: startMock, stop: stopMock };
  }),
  // Consumed by src/worker.ts's graceful-shutdown wiring; must be re-exported by the mock.
  WORKER_SHUTDOWN_TIMEOUT_MS: 12_000,
}));

vi.mock('@app/worker-health', () => ({
  startWorkerHealthServer: startWorkerHealthServerMock,
}));

vi.mock('@utils/graceful-shutdown', () => ({
  setupGracefulShutdown: setupGracefulShutdownMock,
}));

describe('worker entrypoint shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentryCloseMock.mockResolvedValue(undefined);
    startWorkerHealthServerMock.mockResolvedValue({ close: healthCloseMock });
    setupGracefulShutdownMock.mockImplementation(({ close }) => {
      let shutdownPromise: null | Promise<void> = null;
      return {
        shutdown: () => {
          shutdownPromise ??= close();
          return shutdownPromise;
        },
      };
    });
  });

  it('shares a single shutdown promise for repeated signals', async () => {
    vi.resetModules();
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
    const { shutdown } = await import('@app/worker');
    await new Promise((resolve) => setImmediate(resolve));

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(stopMock).toHaveBeenCalledTimes(1);
    exitMock.mockRestore();
  });

  it('connects app before starting worker and closes orm on failure', async () => {
    vi.resetModules();
    startMock.mockRejectedValueOnce(new Error('boom'));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);

    await import('@app/worker');
    await new Promise((resolve) => setImmediate(resolve));

    expect(connectMock).toHaveBeenCalled();
    expect(startMock).toHaveBeenCalled();
    const connectOrder = connectMock.mock.invocationCallOrder[0];
    const startOrder = startMock.mock.invocationCallOrder[0];
    if (connectOrder == null || startOrder == null) throw new Error('missing call order');
    expect(connectOrder).toBeLessThan(startOrder);
    expect(stopMock).toHaveBeenCalled();
    expect(healthCloseMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
    exitMock.mockRestore();
  });

  it('still closes the database when worker stop rejects during shutdown', async () => {
    stopMock.mockRejectedValueOnce(new Error('stop failed'));

    vi.resetModules();
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
    await import('@app/worker');
    await new Promise((resolve) => setImmediate(resolve));

    const firstCall = setupGracefulShutdownMock.mock.calls[0];
    const [{ afterClose, close }] = firstCall as [{ afterClose: () => Promise<void>; close: () => Promise<void> }];

    await expect(close()).rejects.toThrow('stop failed');
    expect(healthCloseMock).toHaveBeenCalled();

    // `closeDatabase` is wired as `afterClose`, which the shutdown helper runs on both the
    // clean-drain and timed-out paths — i.e. outside the race that `close()` can lose. That is
    // what guarantees the connection pool is released even when draining the worker throws.
    await afterClose();
    expect(closeMock).toHaveBeenCalled();
  });

  it('initialises error reporting before the worker is created', async () => {
    vi.resetModules();
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);

    await import('@app/worker');

    // The mocked module is evaluated once per file, so the first entry is the first load.
    expect(loadOrder[0]).toBe('sentry');
    expect(loadOrder).toContain('createWorker');
  });

  it('reports unhealthy on /health until the worker has registered its queues', async () => {
    vi.resetModules();
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
    await import('@app/worker');
    await new Promise((resolve) => setImmediate(resolve));

    const [{ status }] = startWorkerHealthServerMock.mock.calls[0] as [{ status: () => Promise<{ ok: boolean; pgBoss: boolean }> }];

    isRunningMock.mockReturnValue(false);
    await expect(status()).resolves.toMatchObject({ ok: false, pgBoss: false });

    isRunningMock.mockReturnValue(true);
    await expect(status()).resolves.toMatchObject({ ok: true, pgBoss: true });
  });
});

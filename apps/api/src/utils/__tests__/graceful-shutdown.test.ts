import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupGracefulShutdown } from '@utils/graceful-shutdown';

const silentLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

const never = () => new Promise<void>(() => { /* deliberately never settles */ });

describe('setupGracefulShutdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    process.exitCode = undefined;
  });

  const harness = (options: { afterClose?: () => Promise<void>; close: () => Promise<void>; timeoutMs?: number }) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
    const { shutdown } = setupGracefulShutdown({
      afterCloseTimeoutMs: 50,
      logger: silentLogger,
      name: 'worker',
      timeoutMs: options.timeoutMs ?? 50,
      ...options,
    });
    return { exit, shutdown };
  };

  it('runs afterClose and exits 0 on a clean shutdown', async () => {
    const afterClose = vi.fn().mockResolvedValue(undefined);
    const { exit, shutdown } = harness({ afterClose, close: vi.fn().mockResolvedValue(undefined) });

    await shutdown('SIGTERM');

    expect(afterClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('still runs afterClose when close() times out', async () => {
    // With equal budgets, a full pg-boss drain would reject the outer race, `closeDatabase()`
    // inside the raced promise's `finally` would be abandoned, and the process would exit 1
    // with its Postgres connections left to the server to clean up.
    const afterClose = vi.fn().mockResolvedValue(undefined);
    const { exit, shutdown } = harness({ afterClose, close: never, timeoutMs: 20 });

    await shutdown('SIGTERM');

    expect(afterClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when afterClose itself fails, without hanging on it', async () => {
    const { exit, shutdown } = harness({ afterClose: never, close: vi.fn().mockResolvedValue(undefined) });

    await shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('shuts down once even when signalled repeatedly', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const afterClose = vi.fn().mockResolvedValue(undefined);
    const { shutdown } = harness({ afterClose, close });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(close).toHaveBeenCalledOnce();
    expect(afterClose).toHaveBeenCalledOnce();
  });
});

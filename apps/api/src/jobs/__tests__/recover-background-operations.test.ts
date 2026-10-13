import { describe, expect, it, vi } from 'vitest';

const { boss, dispose, recoveryOnce, start } = vi.hoisted(() => ({
  boss: { createQueue: vi.fn(), findJobs: vi.fn(), send: vi.fn(), sendAfter: vi.fn(), updateQueue: vi.fn() },
  dispose: vi.fn(),
  recoveryOnce: vi.fn(),
  start: vi.fn(),
}));

const runtime = { boss, dispose, start };

const app = { connect: vi.fn(), orm: { close: vi.fn() } };

import { runRecoveryCommand } from '../recover-background-operations';

describe('recover-background-operations command', () => {
  it('runs bootstrap start -> recover -> stop/close', async () => {
    recoveryOnce.mockResolvedValueOnce({ needsAction: 0, processed: 1, reenqueued: 1, skipped: 0 });

    await runRecoveryCommand({
      app,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      recoveryService: { recoverOnce: recoveryOnce },
      runtime,
    });

    expect(app.connect).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
    expect(recoveryOnce).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
    expect(app.orm.close).toHaveBeenCalled();
  });

  it('always closes ORM when runtime startup fails and preserves startup error', async () => {
    recoveryOnce.mockClear();
    app.orm.close.mockClear();
    const startupError = new Error('startup failed');
    start.mockRejectedValueOnce(startupError);
    dispose.mockRejectedValueOnce(new Error('dispose failed'));
    await expect(runRecoveryCommand({ app, logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }, recoveryService: { recoverOnce: recoveryOnce }, runtime })).rejects.toBe(startupError);
    expect(dispose).toHaveBeenCalled();
    expect(app.orm.close).toHaveBeenCalled();
    expect(recoveryOnce).not.toHaveBeenCalled();
  });

  it('preserves recovery error when runtime disposal fails and still closes ORM', async () => {
    app.orm.close.mockClear();
    const recoveryError = new Error('recovery failed');
    recoveryOnce.mockRejectedValueOnce(recoveryError);
    dispose.mockRejectedValueOnce(new Error('dispose failed'));
    await expect(runRecoveryCommand({ app, logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }, recoveryService: { recoverOnce: recoveryOnce }, runtime })).rejects.toBe(recoveryError);
    expect(app.orm.close).toHaveBeenCalled();
  });
});

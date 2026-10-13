import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const scheduleLifecycleSteps = vi.fn();
const enqueue = { send: vi.fn(), sendAfter: vi.fn() };

vi.mock('@app/database/di', () => ({ DI: { em: { getConnection: () => ({ execute }) } } }));
vi.mock('@service/lifecycle/lifecycle-enrollment', () => ({ scheduleLifecycleSteps }));

const { runDataHealthSweep, runLifecycleSweeps } = await import('@service/lifecycle/lifecycle-cron');

describe('runDataHealthSweep', () => {
  const now = new Date('2026-07-28T09:00:00.000Z');

  beforeEach(() => {
    execute.mockReset();
    scheduleLifecycleSteps.mockReset();
  });

  it('only enrolls users with a linked connection expiring within the renewal window', async () => {
    execute.mockResolvedValue([{ appuserKey: 7 }, { appuserKey: 9 }]);
    await runDataHealthSweep(enqueue, now);

    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/status = 'linked'/),
      ['2026-08-11T09:00:00.000Z'],
    );
    const [sql] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/from enable_banking_connection/);
    expect(sql).toMatch(/access_valid_until <= \?/);

    expect(scheduleLifecycleSteps).toHaveBeenCalledTimes(2);
    expect(scheduleLifecycleSteps).toHaveBeenCalledWith(expect.anything(), enqueue, 'data_health', 7, 'data-health.v1', [{ scheduledFor: now, step: 'consent_expiring' }]);
    expect(scheduleLifecycleSteps).toHaveBeenCalledWith(expect.anything(), enqueue, 'data_health', 9, 'data-health.v1', [{ scheduledFor: now, step: 'consent_expiring' }]);
  });

  it('enrolls nobody when no connection is nearing expiry', async () => {
    execute.mockResolvedValue([]);
    await runDataHealthSweep(enqueue, now);
    expect(scheduleLifecycleSteps).not.toHaveBeenCalled();
  });
});

describe('runLifecycleSweeps', () => {
  it('runs the data-health sweep (service-continuity, exempt from marketing opt-out)', async () => {
    execute.mockResolvedValue([{ appuserKey: 7 }]);
    await runLifecycleSweeps(enqueue, new Date('2026-07-28T09:00:00.000Z'));
    expect(scheduleLifecycleSteps).toHaveBeenCalledWith(expect.anything(), enqueue, 'data_health', 7, 'data-health.v1', [
      { scheduledFor: new Date('2026-07-28T09:00:00.000Z'), step: 'consent_expiring' },
    ]);
  });

});

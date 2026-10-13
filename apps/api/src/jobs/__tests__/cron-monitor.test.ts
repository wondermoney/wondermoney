import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureCheckIn: vi.fn(() => 'check-in-1') }));
vi.mock('@sentry/node', () => sentry);

import { CERTIFICADO_AFORRO_RATE_SYNC_CRON, CERTIFICADO_AFORRO_RATE_SYNC_MONITOR_SLUG } from '@app/jobs/certificado-aforro-rate-sync.queue';
import { withCronMonitor } from '@app/jobs/cron-monitor';

const OPTIONS = { monitorSlug: 'test-job', schedule: '0 5 * * *' };

beforeEach(() => {
  sentry.captureCheckIn.mockReset();
  sentry.captureCheckIn.mockReturnValue('check-in-1');
});

describe('withCronMonitor', () => {
  it('opens and closes a check-in around a successful run, upserting the monitor config', async () => {
    const result = await withCronMonitor(OPTIONS, () => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(sentry.captureCheckIn).toHaveBeenCalledTimes(2);
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: 'test-job', status: 'in_progress' },
      // Sent with the check-in so the monitor needs no manual setup in Sentry.
      { checkinMargin: 60, maxRuntime: 30, schedule: { type: 'crontab', value: '0 5 * * *' }, timezone: 'UTC' },
    );
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: 'check-in-1',
      monitorSlug: 'test-job',
      status: 'ok',
    });
  });

  /**
   * The point of the monitor is liveness. A run that completes and reports a
   * business-level problem has already raised a richer Sentry event of its own;
   * failing the check-in too would double-alert and devalue the monitor.
   */
  it("reports 'ok' for a run that completes with a failed business outcome", async () => {
    await withCronMonitor(OPTIONS, () => Promise.resolve({ outcome: 'not-published', written: [] }));

    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ok' }));
  });

  it("reports 'error' and rethrows when the handler throws", async () => {
    const boom = new Error('handler exploded');

    await expect(withCronMonitor(OPTIONS, () => Promise.reject(boom))).rejects.toThrow('handler exploded');
    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('still runs the job when Sentry itself is broken, and returns its result', async () => {
    // A monitoring wrapper that can take the job down is worse than no monitoring.
    sentry.captureCheckIn.mockImplementation(() => {
      throw new Error('sentry unavailable');
    });

    await expect(withCronMonitor(OPTIONS, () => Promise.resolve('done'))).resolves.toBe('done');
  });

  it('does not try to close a check-in that never opened', async () => {
    sentry.captureCheckIn.mockImplementationOnce(() => {
      throw new Error('sentry unavailable');
    });

    await withCronMonitor(OPTIONS, () => Promise.resolve('done'));

    // Only the failed open attempt — no close with an undefined checkInId.
    expect(sentry.captureCheckIn).toHaveBeenCalledTimes(1);
  });

  it('monitors the rate-sync job on the same crontab it is scheduled with', () => {
    // A monitor whose schedule drifts from the job's own cron alerts at the wrong
    // times, so the worker passes the queue's exported constant, not a copy.
    expect(CERTIFICADO_AFORRO_RATE_SYNC_CRON).toBe('0 5 * * *');
    expect(CERTIFICADO_AFORRO_RATE_SYNC_MONITOR_SLUG).toBe('certificado-aforro-rate-sync');
  });
});

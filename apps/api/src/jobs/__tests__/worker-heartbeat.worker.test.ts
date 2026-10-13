import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleWorkerHeartbeatJob } from '@app/jobs/worker-heartbeat.worker';

const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  Object.values(log).forEach((m) => m.mockReset());
});

describe('worker heartbeat worker', () => {
  it('pings the configured URL and reports ok on a 2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await handleWorkerHeartbeatJob({
      env: { HETRIX_WORKER_HEARTBEAT_URL: 'https://sm.hetrixtools.net/hb/?s=abc' },
      fetch: fetchMock as unknown as typeof fetch,
      logger: log,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://sm.hetrixtools.net/hb/?s=abc', expect.objectContaining({ signal: expect.anything() }));
    expect(result).toEqual({ ok: true, status: 200 });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('skips (never throws) when the heartbeat URL is not configured', async () => {
    const fetchMock = vi.fn();

    const result = await handleWorkerHeartbeatJob({ env: {}, fetch: fetchMock as unknown as typeof fetch, logger: log });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, skipped: true });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('reports not-ok on a non-2xx response without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const result = await handleWorkerHeartbeatJob({
      env: { HETRIX_WORKER_HEARTBEAT_URL: 'https://sm.hetrixtools.net/hb/?s=abc' },
      fetch: fetchMock as unknown as typeof fetch,
      logger: log,
    });

    expect(result).toEqual({ ok: false, status: 503 });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('swallows fetch errors so a failed ping never retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await handleWorkerHeartbeatJob({
      env: { HETRIX_WORKER_HEARTBEAT_URL: 'https://sm.hetrixtools.net/hb/?s=abc' },
      fetch: fetchMock as unknown as typeof fetch,
      logger: log,
    });

    expect(result).toEqual({ ok: false });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

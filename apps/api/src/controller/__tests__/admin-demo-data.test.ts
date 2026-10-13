import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({ zParse: vi.fn((_schema, req: unknown) => req) }));
vi.mock('@app/jobs/demo-data-refresh.queue', () => ({
  enqueueDemoDataRefreshJob: enqueueMock,
}));

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { triggerDemoDataRefresh } from '../admin/demo-data';

const response = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { json, res: mockRes({ json, status }), status };
};

describe('admin demo data refresh', () => {
  const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueMock.mockResolvedValue('job-7');
  });

  it('enqueues the refresh and answers 202 with the job id', async () => {
    const { json, res, status } = response();

    await triggerDemoDataRefresh({ body: { asOfDate: '2026-09-27', dryRun: true }, enqueue } as unknown as Parameters<typeof triggerDemoDataRefresh>[0], res);

    expect(enqueueMock).toHaveBeenCalledWith({ asOfDate: '2026-09-27', dryRun: true }, expect.anything());
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ jobId: 'job-7', queue: 'demo-data.refresh' });
  });

  it('reports a null job id rather than undefined when pg-boss dedups the job', async () => {
    // `send` returns null when a singleton key collides, which is a successful no-op rather
    // than a failure — the caller has to be able to tell that apart from a queued job.
    enqueueMock.mockResolvedValue(null);
    const { json, res } = response();

    await triggerDemoDataRefresh({ body: {}, enqueue } as unknown as Parameters<typeof triggerDemoDataRefresh>[0], res);

    expect(json).toHaveBeenCalledWith({ jobId: null, queue: 'demo-data.refresh' });
  });

  it('propagates enqueue failures', async () => {
    enqueueMock.mockRejectedValue(new Error('queue unavailable'));
    const { res } = response();

    await expect(triggerDemoDataRefresh({ body: {}, enqueue } as unknown as Parameters<typeof triggerDemoDataRefresh>[0], res)).rejects.toThrow('queue unavailable');
  });
});

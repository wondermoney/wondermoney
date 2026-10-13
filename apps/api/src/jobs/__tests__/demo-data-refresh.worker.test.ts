import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@service/demo-data/demo-data-refresh.service', () => ({
  DemoDataRefreshService: vi.fn(function DemoDataRefreshServiceMock() {
    return refreshMock;
  }),
}));

import { handleDemoDataRefreshJob } from '@app/jobs/demo-data-refresh.worker';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

const job = (data: unknown) =>
  pgBossJob(data, { id: 'j' }) as unknown as Parameters<typeof handleDemoDataRefreshJob>[0];

beforeEach(() => refreshMock.refresh.mockReset());

describe('demo data refresh worker', () => {
  it('passes parsed asOfDate and dryRun to the service', async () => {
    refreshMock.refresh.mockResolvedValueOnce({ ok: true });

    await expect(
      handleDemoDataRefreshJob(job({ asOfDate: '2026-01-02', dryRun: true })),
    ).resolves.toEqual({ ok: true });

    expect(refreshMock.refresh).toHaveBeenCalledWith({ asOfDate: new Date('2026-01-02'), dryRun: true });
  });

  it('defaults dryRun to false', async () => {
    refreshMock.refresh.mockResolvedValueOnce({ ok: true });

    await handleDemoDataRefreshJob(job({}));

    expect(refreshMock.refresh).toHaveBeenCalledWith({ asOfDate: undefined, dryRun: false });
  });

  it('rejects invalid asOfDate values', async () => {
    await expect(handleDemoDataRefreshJob(job({ asOfDate: 'not-a-date' }))).rejects.toThrow(
      'Invalid asOfDate value: not-a-date',
    );
    await expect(handleDemoDataRefreshJob(job({ asOfDate: '' }))).rejects.toThrow(
      'Invalid asOfDate value: ',
    );
    await expect(handleDemoDataRefreshJob(job({ asOfDate: '1' }))).rejects.toThrow(
      'Invalid asOfDate value: 1',
    );
    await expect(handleDemoDataRefreshJob(job({ asOfDate: '2026-02-30' }))).rejects.toThrow(
      'Invalid asOfDate value: 2026-02-30',
    );
    await expect(handleDemoDataRefreshJob(job({ asOfDate: '2026-02-31' }))).rejects.toThrow(
      'Invalid asOfDate value: 2026-02-31',
    );
  });
});

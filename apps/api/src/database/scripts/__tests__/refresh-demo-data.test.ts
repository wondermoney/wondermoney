import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeDatabaseMock, connectDatabaseMock, forkMock, refreshMock } = vi.hoisted(() => ({
  closeDatabaseMock: vi.fn().mockResolvedValue(undefined),
  connectDatabaseMock: vi.fn().mockResolvedValue(undefined),
  forkMock: vi.fn().mockReturnValue({}),
  refreshMock: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@app/database/di', () => ({
  closeDatabase: closeDatabaseMock,
  connectDatabase: connectDatabaseMock,
  DI: { em: { fork: forkMock }, orm: { em: { fork: forkMock } } },
}));

vi.mock('@service/demo-data/demo-data-refresh.service', () => ({
  DemoDataRefreshService: vi.fn(function DemoDataRefreshServiceMock() {
    return { refresh: refreshMock };
  }),
}));

import { main, parseDemoRefreshArgs } from '../refresh-demo-data';

beforeEach(() => {
  refreshMock.mockClear();
  connectDatabaseMock.mockClear();
  closeDatabaseMock.mockClear();
});

describe('parseDemoRefreshArgs', () => {
  it('defaults to a live run at "now" and anchors --as-of-date to UTC midnight', () => {
    const before = new Date();
    const defaults = parseDemoRefreshArgs([]);
    const after = new Date();

    expect(defaults.dryRun).toBe(false);
    expect(defaults.asOfDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(defaults.asOfDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    expect(parseDemoRefreshArgs(['--dry-run'])).toMatchObject({ dryRun: true });
    expect(parseDemoRefreshArgs(['--as-of-date', '2026-06-05'])).toMatchObject({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      dryRun: false,
    });
  });

  it('fails closed on invalid date', () => {
    expect(() => parseDemoRefreshArgs(['--as-of-date', '2026-02-30'])).toThrow(
      'Invalid --as-of-date value: 2026-02-30',
    );
  });

  it('main connects db, refreshes data, and closes db', async () => {
    await expect(main(['--dry-run'])).resolves.toEqual({ ok: true });
    expect(connectDatabaseMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(closeDatabaseMock).toHaveBeenCalledTimes(1);
  });
});

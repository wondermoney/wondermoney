import { describe, expect, it, vi } from 'vitest';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';
import { handleFinancialEmailCoordinator } from '../financial-emails.coordinator';
import { MONTHLY_STORY_EMAIL_DELIVERY_QUEUE } from '../financial-emails.queue';

type CoordinatorJob = Parameters<typeof handleFinancialEmailCoordinator>[0];
const coordinatorJob = (input: { createdOn?: Date; data?: Record<string, unknown>; id: string }): CoordinatorJob =>
  ({ ...pgBossJob(input.data ?? {}, { id: input.id }), createdOn: input.createdOn }) as unknown as CoordinatorJob;

describe('financial email coordinator', () => {
  it('pages, deduplicates appusers and preserves immutable created timestamp', async () => {
    const page = vi.fn().mockResolvedValue([1, 2]);
    const send = vi.fn().mockResolvedValueOnce('user-1').mockResolvedValueOnce('user-2').mockResolvedValueOnce('continuation');
    const job = coordinatorJob({ createdOn: new Date('2026-07-18T08:00:00.000Z'), data: {}, id: 'job-1' });
    const result = await handleFinancialEmailCoordinator(job, 'budget', { boss: { send }, candidates: { page }, pageSize: 2 });
    expect(result).toEqual({ candidates: 2, continuation: 'queued', continued: true, nextCursor: 2, pages: 1, queued: 2, reason: 'queued' });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.every((call) => call[1].scheduledFor === '2026-07-18T08:00:00.000Z')).toBe(true);
    expect(send.mock.calls[2]?.[1]).toMatchObject({ cursor: 2 });
    expect(send.mock.calls[2]?.[2]).toMatchObject({ singletonKey: 'budget:20260718:cursor:2' });
    expect(JSON.stringify(result)).not.toContain('@');
  });

  it('counts only accepted user sends and reports deduplicated continuation', async () => {
    const page = vi.fn().mockResolvedValue([1, 2, 3]);
    const send = vi.fn().mockResolvedValueOnce('accepted').mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const result = await handleFinancialEmailCoordinator(coordinatorJob({ createdOn: new Date('2026-07-18T08:00:00.000Z'), data: {}, id: 'job-2' }), 'budget', { boss: { send }, candidates: { page }, pageSize: 3 });
    expect(result).toMatchObject({ candidates: 3, continuation: 'deduplicated', continued: true, queued: 1, reason: 'queued' });
  });

  it('reports replayed singleton sends as deduplicated without inflating queued', async () => {
    const page = vi.fn().mockResolvedValue([1, 2]);
    const send = vi.fn().mockResolvedValue(null);
    const result = await handleFinancialEmailCoordinator(coordinatorJob({ createdOn: new Date('2026-07-18T08:00:00.000Z'), data: { cursor: 10 }, id: 'retry' }), 'weekly', { boss: { send }, candidates: { page }, pageSize: 10 });
    expect(result).toMatchObject({ candidates: 2, continuation: 'not_needed', queued: 0, reason: 'deduplicated' });
  });

  it('keeps paginating when a duplicate row shrinks the deduplicated page below pageSize', async () => {
    // A join fan-out (plausible for a two-member household) returns the same appuserKey
    // twice. `continued` used to be computed from the DEDUPED array, so a full page of 3
    // rows that deduped to 2 read as "no next page" — and every candidate after that
    // cursor silently never got the email, while the run reported a clean `queued`.
    const page = vi.fn().mockResolvedValue([1, 2, 2]);
    const send = vi.fn().mockResolvedValue('queued');
    const result = await handleFinancialEmailCoordinator(coordinatorJob({ createdOn: new Date('2026-07-18T08:00:00.000Z'), data: {}, id: 'job-fanout' }), 'budget', { boss: { send }, candidates: { page }, pageSize: 3 });

    expect(result).toMatchObject({ candidates: 2, continuation: 'queued', continued: true, nextCursor: 2 });
    // Two user sends (deduped) plus the continuation job.
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[1]).toMatchObject({ cursor: 2 });
  });

  it('still stops when the raw page is genuinely short', async () => {
    const page = vi.fn().mockResolvedValue([1, 2]);
    const send = vi.fn().mockResolvedValue('queued');
    const result = await handleFinancialEmailCoordinator(coordinatorJob({ createdOn: new Date('2026-07-18T08:00:00.000Z'), data: {}, id: 'job-short' }), 'budget', { boss: { send }, candidates: { page }, pageSize: 3 });

    expect(result).toMatchObject({ continuation: 'not_needed', continued: false });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects jobs without immutable schedule timestamp', async () => {
    await expect(handleFinancialEmailCoordinator(coordinatorJob({ data: {}, id: 'x' }), 'weekly', { boss: { send: vi.fn() }, candidates: { page: vi.fn() } })).rejects.toThrow('financial_email_scheduled_for_required');
  });

  it('builds a YYYYMM period key for the JUST-CLOSED month when the monthlyStory cron fires on the 1st', async () => {
    // The cron ('0 9 1 * *') fires on the 1st. A 1st-of-August trigger narrates July 2026 (the month
    // that just closed), so the dedup/period key must be 202607, NOT 202608 (the trigger month) —
    // matching the subject-period offset in aggregateMonthlyStory.
    const page = vi.fn().mockResolvedValue([1]);
    const send = vi.fn().mockResolvedValueOnce('user-1');
    const result = await handleFinancialEmailCoordinator(coordinatorJob({ createdOn: new Date('2026-08-01T08:00:00.000Z'), data: {}, id: 'job-3' }), 'monthlyStory', { boss: { send }, candidates: { page }, pageSize: 10 });
    expect(result).toMatchObject({ candidates: 1, queued: 1, reason: 'queued' });
    expect(send).toHaveBeenCalledWith(MONTHLY_STORY_EMAIL_DELIVERY_QUEUE, expect.objectContaining({ correlationId: 'monthlyStory:202607:job-3' }), expect.objectContaining({ singletonKey: 'monthlyStory:202607:1' }));
  });
});

import { describe, expect, it, vi } from 'vitest';

import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';

type OutboxEm = Parameters<typeof recordAnalyticsOutboxEvent>[0];

const EXTERNAL_USER_ID = '1f8fab82-1cc1-427b-9f51-5b9fe416bd88';

describe('analytics outbox producer', () => {
  it('persists an idempotent event and owns the deterministic insert id', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const input = {
      distinctId: EXTERNAL_USER_ID,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties: { $insert_id: 'untrusted', appuser_key: '42' },
    };

    await recordAnalyticsOutboxEvent({ upsert } as unknown as OutboxEm, input);
    await recordAnalyticsOutboxEvent({ upsert } as unknown as OutboxEm, input);

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [entity, data, options] of upsert.mock.calls) {
      expect(entity).toBe(AnalyticsOutbox);
      expect(data).toMatchObject({
        distinctId: EXTERNAL_USER_ID,
        eventId: 'login.v1:session-1',
        eventName: 'login',
        properties: { $insert_id: 'login.v1:session-1', appuser_key: '42' },
      });
      expect(data.createdAt).toBeInstanceOf(Date);
      expect(data.updatedAt).toBe(data.createdAt);
      expect(options).toEqual({ onConflictAction: 'ignore', onConflictFields: ['eventId'] });
    }
  });

  it.each([
    '1F8FAB82-1CC1-427B-9F51-5B9FE416BD88',
    'not-a-uuid',
    ` ${EXTERNAL_USER_ID}`,
  ])('rejects a non-canonical external identity: %s', async (distinctId) => {
    const upsert = vi.fn();

    await expect(recordAnalyticsOutboxEvent({ upsert } as unknown as OutboxEm, {
      distinctId,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties: {},
    })).rejects.toThrow('canonical lowercase external UUID');

    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    { email: 'ada@example.com' },
    { nested: { contact: 'ada@example.com' } },
    { reason: 'customer ada@example.com failed' },
    { $set: { plan: 'growth' } },
  ])('rejects sensitive analytics properties', async (properties) => {
    const upsert = vi.fn();

    await expect(recordAnalyticsOutboxEvent({ upsert } as unknown as OutboxEm, {
      distinctId: EXTERNAL_USER_ID,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties,
    })).rejects.toThrow('sensitive data');

    expect(upsert).not.toHaveBeenCalled();
  });
});

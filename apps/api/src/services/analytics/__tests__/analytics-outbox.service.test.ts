import { describe, expect, it, vi } from 'vitest';

import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';


const EXTERNAL_USER_ID = '1f8fab82-1cc1-427b-9f51-5b9fe416bd88';
const LIVE = { ANALYTICS_OUTBOX_MODE: 'live' } as NodeJS.ProcessEnv;

describe('analytics outbox producer', () => {
  it('persists an idempotent event and owns the deterministic insert id', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const input = {
      distinctId: EXTERNAL_USER_ID,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties: { $insert_id: 'untrusted', locale: 'EN', method: 'email' },
    };

    await recordAnalyticsOutboxEvent({ upsert }, input, LIVE);
    await recordAnalyticsOutboxEvent({ upsert }, input, LIVE);

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [entity, data, options] of upsert.mock.calls) {
      expect(entity).toBe(AnalyticsOutbox);
      expect(data).toMatchObject({
        distinctId: EXTERNAL_USER_ID,
        eventId: 'login.v1:session-1',
        eventName: 'login',
        properties: { $insert_id: 'login.v1:session-1', locale: 'EN', method: 'email' },
      });
      expect(data.createdAt).toBeInstanceOf(Date);
      expect(data.updatedAt).toBe(data.createdAt);
      expect(options).toEqual({ onConflictAction: 'ignore', onConflictFields: ['eventId'] });
    }
  });

  // A self-hosted instance delivers nothing by default, so it must not pile up rows either.
  it.each([
    {},
    { ANALYTICS_OUTBOX_MODE: 'off' },
    { ANALYTICS_OUTBOX_MODE: 'internal-allowlist' },
  ])('writes nothing while delivery is off: %o', async (env) => {
    const upsert = vi.fn();

    await recordAnalyticsOutboxEvent({ upsert }, {
      distinctId: EXTERNAL_USER_ID,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties: { locale: 'EN', method: 'email' },
    }, env);

    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    '1F8FAB82-1CC1-427B-9F51-5B9FE416BD88',
    'not-a-uuid',
    ` ${EXTERNAL_USER_ID}`,
  ])('rejects a non-canonical external identity: %s', async (distinctId) => {
    const upsert = vi.fn();

    await expect(recordAnalyticsOutboxEvent({ upsert }, {
      distinctId,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties: {},
    }, LIVE)).rejects.toThrow('canonical lowercase external UUID');

    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    { email: 'ada@example.com' },
    { nested: { contact: 'ada@example.com' } },
    { reason: 'customer ada@example.com failed' },
    { $set: { plan: 'growth' } },
  ])('rejects sensitive analytics properties', async (properties) => {
    const upsert = vi.fn();

    await expect(recordAnalyticsOutboxEvent({ upsert }, {
      distinctId: EXTERNAL_USER_ID,
      eventId: 'login.v1:session-1',
      eventName: 'login',
      properties,
    }, LIVE)).rejects.toThrow('sensitive data');

    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['an event that is not catalogued', 'account_delete', {}, 'account_delete is not in the event catalogue'],
    ['a behavioural event of the apps', 'feature_screen_viewed', { screen: 'dashboard' }, 'feature_screen_viewed is not sent from server'],
    ['a property the event does not have', 'login', { appuser_key: '42', locale: 'EN', method: 'email' }, 'login has no property appuser_key'],
    ['a value outside its list', 'login', { locale: 'EN', method: 'facebook' }, 'login.method is not a valid enum'],
  ])('refuses %s, whether or not delivery is on', async (_case, eventName, properties, problem) => {
    for (const env of [LIVE, {}]) {
      const upsert = vi.fn();
      await expect(recordAnalyticsOutboxEvent({ upsert }, { distinctId: EXTERNAL_USER_ID, eventId: 'event-1', eventName, properties }, env)).rejects.toThrow(problem);
      expect(upsert).not.toHaveBeenCalled();
    }
  });
});

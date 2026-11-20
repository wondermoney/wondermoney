import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { recordFirstActivation } from '@service/analytics/first-activation.service';

const EXTERNAL_USER_ID = '6b1d5f0e-8f4a-4c55-9d2e-3a7b9c0d1e2f';
const LIVE = { ANALYTICS_OUTBOX_MODE: 'live' } as NodeJS.ProcessEnv;
const appuser = { appuserKey: 42, externalUserId: EXTERNAL_USER_ID };

/** An outbox that keeps the first row per event id, like the unique `event_id` index. */
function fakeOutbox() {
  const rows = new Map<string, { eventName: string; properties: Record<string, unknown> }>();
  const upsert = vi.fn((_entity: unknown, data?: unknown) => {
    const row = data as { eventId: string; eventName: string; properties: Record<string, unknown> };
    if (!rows.has(row.eventId)) rows.set(row.eventId, { eventName: row.eventName, properties: row.properties });
    return Promise.resolve({});
  });
  return { rows, upsert } as unknown as { rows: typeof rows; upsert: Pick<EntityManager, 'upsert'>['upsert'] };
}

describe('recordFirstActivation', () => {
  it('records one event for the first budget and one for the first goal, however many follow', async () => {
    const outbox = fakeOutbox();

    await recordFirstActivation(outbox, appuser, 'budget', LIVE);
    await recordFirstActivation(outbox, appuser, 'budget', LIVE);
    await recordFirstActivation(outbox, appuser, 'goal', LIVE);
    await recordFirstActivation(outbox, appuser, 'goal', LIVE);

    expect([...outbox.rows.values()].map((row) => row.eventName)).toEqual(['first_budget_created', 'first_goal_created']);
    for (const row of outbox.rows.values()) expect(row.properties).toMatchObject({ appuser_key: '42' });
  });

  it('records nothing while analytics delivery is off', async () => {
    const outbox = fakeOutbox();

    await recordFirstActivation(outbox, appuser, 'budget', {});

    expect(outbox.rows.size).toBe(0);
  });

  it('skips an account without a canonical identity', async () => {
    const outbox = fakeOutbox();

    await recordFirstActivation(outbox, { appuserKey: 7, externalUserId: 'legacy-id' }, 'goal', LIVE);

    expect(outbox.rows.size).toBe(0);
  });

  it('never fails the request when the outbox write fails', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('connection lost'));

    await expect(recordFirstActivation({ upsert }, appuser, 'budget', LIVE)).resolves.toBeUndefined();
  });
});

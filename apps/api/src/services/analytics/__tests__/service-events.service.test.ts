import type { EntityManager } from '@mikro-orm/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  importCommittedEventId,
  recordAccountCreated,
  recordBudgetCreated,
  recordGoalCreated,
  recordServiceEvent,
  recordUserActive,
  requestPlatform,
  resetRecordedActiveDays,
} from '@service/analytics/service-events.service';

const PERSON = { externalUserId: '6b1d5f0e-8f4a-4c55-9d2e-3a7b9c0d1e2f' };
const OTHER = { externalUserId: '0c9a8b7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d' };
const LIVE = { ANALYTICS_OUTBOX_MODE: 'live' } as NodeJS.ProcessEnv;

/** An outbox that keeps the first row per event id, like the unique `event_id` index. */
function fakeOutbox() {
  const rows = new Map<string, { distinctId: string; eventName: string; properties: Record<string, unknown> }>();
  const upsert = vi.fn((_entity: unknown, data?: unknown) => {
    const row = data as { distinctId: string; eventId: string; eventName: string; properties: Record<string, unknown> };
    if (!rows.has(row.eventId)) rows.set(row.eventId, row);
    return Promise.resolve({});
  });
  const em = { upsert } as unknown as Pick<EntityManager, 'upsert'>;
  return { em, events: () => [...rows.values()].map((row) => row.eventName), rows, upsert };
}

describe('service events', () => {
  afterEach(() => { resetRecordedActiveDays(); });

  it('records every account, budget and goal, and the first of each once per person', async () => {
    const outbox = fakeOutbox();

    for (let index = 0; index < 2; index += 1) {
      await recordAccountCreated(outbox.em, PERSON, { method: 'manual', platform: 'web' }, LIVE);
      await recordBudgetCreated(outbox.em, PERSON, { platform: 'mobile' }, LIVE);
      await recordGoalCreated(outbox.em, PERSON, { platform: 'api', type: 'debt_paydown' }, LIVE);
    }
    await recordAccountCreated(outbox.em, OTHER, { method: 'bank_connection' }, LIVE);

    expect(outbox.events().sort()).toEqual([
      'account_created', 'account_created', 'account_created',
      'budget_created', 'budget_created',
      'first_account_created', 'first_account_created',
      'first_budget_created',
      'first_goal_created',
      'goal_created', 'goal_created',
    ]);
    const firstGoal = [...outbox.rows.values()].find((row) => row.eventName === 'first_goal_created');
    expect(firstGoal?.properties).toEqual({ $insert_id: expect.any(String), platform: 'api', type: 'debt_paydown' });
  });

  it('sends no database key, not even in the event id PostHog receives', async () => {
    const outbox = fakeOutbox();

    await recordAccountCreated(outbox.em, PERSON, { method: 'import' }, LIVE);

    for (const [eventId, row] of outbox.rows) {
      expect(Object.keys(row.properties).sort()).toEqual(['$insert_id', 'method']);
      expect(eventId).toMatch(/^[a-z_]+\.v1:[0-9a-f-]{36}$/u);
    }
  });

  it('records nothing while delivery is off, or for an account without a canonical identity', async () => {
    const outbox = fakeOutbox();

    await recordBudgetCreated(outbox.em, PERSON, { platform: 'web' }, {});
    await recordBudgetCreated(outbox.em, { externalUserId: 'legacy-id' }, { platform: 'web' }, LIVE);
    await recordBudgetCreated(outbox.em, undefined, { platform: 'web' }, LIVE);

    expect(outbox.upsert).not.toHaveBeenCalled();
  });

  it('never fails the change it follows, when the write fails or the catalogue refuses it', async () => {
    const failing = { upsert: vi.fn().mockRejectedValue(new Error('connection lost')) } as unknown as Pick<EntityManager, 'upsert'>;
    await expect(recordGoalCreated(failing, PERSON, { type: 'save_up' }, LIVE)).resolves.toBeUndefined();

    const outbox = fakeOutbox();
    const untyped = recordServiceEvent as unknown as (...args: unknown[]) => Promise<void>;
    await expect(untyped(outbox.em, PERSON, 'budget_created', { amount: 120 }, { env: LIVE })).resolves.toBeUndefined();
    expect(outbox.upsert).not.toHaveBeenCalled();
  });

  it('keeps one import_committed per import', () => {
    expect(importCommittedEventId('import-a')).toBe(importCommittedEventId('import-a'));
    expect(importCommittedEventId('import-a')).not.toBe(importCommittedEventId('import-b'));
    expect(importCommittedEventId('import-a')).not.toContain('import-a');
  });
});

describe('user_active', () => {
  afterEach(() => { resetRecordedActiveDays(); });

  const morning = new Date('2026-11-21T08:00:00.000Z');
  const evening = new Date('2026-11-21T23:30:00.000Z');
  const nextDay = new Date('2026-11-22T00:10:00.000Z');

  it('records each person once per UTC day, from the first client they use', async () => {
    const outbox = fakeOutbox();

    await recordUserActive(outbox.em, PERSON, 'mobile', morning, LIVE);
    await recordUserActive(outbox.em, PERSON, 'web', evening, LIVE);
    await recordUserActive(outbox.em, OTHER, 'api', evening, LIVE);
    await recordUserActive(outbox.em, PERSON, 'web', nextDay, LIVE);

    expect([...outbox.rows.entries()].map(([eventId, row]) => [eventId, row.properties['platform']])).toEqual([
      [`user_active.v1:${PERSON.externalUserId}:2026-11-21`, 'mobile'],
      [`user_active.v1:${OTHER.externalUserId}:2026-11-21`, 'api'],
      [`user_active.v1:${PERSON.externalUserId}:2026-11-22`, 'web'],
    ]);
    // The in-process memory spares the write on later requests the same day.
    expect(outbox.upsert).toHaveBeenCalledTimes(3);
  });

  it('is deduplicated by the outbox across processes', async () => {
    const outbox = fakeOutbox();

    await recordUserActive(outbox.em, PERSON, 'web', morning, LIVE);
    resetRecordedActiveDays(); // a second API process
    await recordUserActive(outbox.em, PERSON, 'mobile', evening, LIVE);

    expect(outbox.rows.size).toBe(1);
  });

  it('records nothing while delivery is off', async () => {
    const outbox = fakeOutbox();

    await recordUserActive(outbox.em, PERSON, 'web', morning, {});

    expect(outbox.upsert).not.toHaveBeenCalled();
  });
});

describe('requestPlatform', () => {
  it.each([
    ['a personal API token or MCP token', { apiToken: { apiTokenKey: 1, scopes: [] }, headers: { authorization: 'Bearer wm_pat_x' } }, 'api'],
    ['a session token in Authorization, as the mobile app sends', { headers: { authorization: 'Bearer abc.def' } }, 'mobile'],
    ['a session cookie, as the web app sends', { headers: { cookie: 'session=abc' } }, 'web'],
  ] as const)('reads %s', (_case, req, platform) => {
    expect(requestPlatform(req as unknown as Parameters<typeof requestPlatform>[0])).toBe(platform);
  });
});

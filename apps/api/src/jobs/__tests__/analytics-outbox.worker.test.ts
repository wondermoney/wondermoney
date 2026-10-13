import { LockMode } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { Appuser } from '@entity/Appuser';

import {
  AcknowledgedPostHogClient,
  deliverAnalyticsOutboxBatch,
} from '../analytics-outbox.worker';

const EXTERNAL_USER_ID = '1f8fab82-1cc1-427b-9f51-5b9fe416bd88';

type AnalyticsOutboxDeps = Parameters<typeof deliverAnalyticsOutboxBatch>[0];

function liveEnv() {
  return { ANALYTICS_OUTBOX_MODE: 'live', POSTHOG_API_KEY: 'test-key' } as NodeJS.ProcessEnv;
}

function makeHarness(options: { row?: AnalyticsOutbox } = {}) {
  const row = options.row ?? makeRow();
  const appuser = { appuserKey: 42, externalUserId: EXTERNAL_USER_ID };
  const execute = vi.fn().mockResolvedValue([{ analyticsOutboxKey: row.analyticsOutboxKey }]);
  const tx = {
    find: vi.fn().mockResolvedValue([row]),
    findOne: vi.fn().mockImplementation((entity: { name?: string }) => {
      if (entity === Appuser || entity.name === 'Appuser') return Promise.resolve(appuser);
      return Promise.resolve(null);
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    getConnection: vi.fn(() => ({ execute })),
  };
  const em = {
    transactional: vi.fn().mockImplementation((callback: (inner: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const posthog = {
    captureBatch: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

  return { appuser, em, execute, logger, posthog, row, tx };
}

function makeRow(overrides: Partial<AnalyticsOutbox> = {}) {
  return Object.assign(new AnalyticsOutbox(), {
    analyticsOutboxKey: 11,
    distinctId: EXTERNAL_USER_ID,
    eventId: `signup.v1:${EXTERNAL_USER_ID}`,
    eventName: 'signup',
    properties: { appuser_key: '42', locale: 'EN' },
    ...overrides,
  });
}

describe('analytics outbox worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for the installed PostHog SDK transport before acknowledging a batch', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
      status: 200,
      text: () => Promise.resolve(''),
    });
    const client = new AcknowledgedPostHogClient('test-key', {
      disableCompression: true,
      fetch,
      fetchRetryCount: 0,
      flushAt: 101,
      flushInterval: 0,
    });

    await client.captureBatch([{
      distinctId: EXTERNAL_USER_ID,
      event: 'signup',
      properties: { $insert_id: `signup.v1:${EXTERNAL_USER_ID}` },
    }]);

    expect(fetch).toHaveBeenCalledOnce();
  });

  it('propagates installed PostHog SDK transport failures', async () => {
    const client = new AcknowledgedPostHogClient('test-key', {
      disableCompression: true,
      fetch: vi.fn().mockRejectedValue(new Error('network unavailable')),
      fetchRetryCount: 0,
      flushAt: 101,
      flushInterval: 0,
    });

    await expect(client.captureBatch([{
      distinctId: EXTERNAL_USER_ID,
      event: 'signup',
      properties: { $insert_id: `signup.v1:${EXTERNAL_USER_ID}` },
    }])).rejects.toMatchObject({ name: 'PostHogFetchNetworkError' });
  });

  it('does not claim or deliver rows while delivery mode is off', async () => {
    const harness = makeHarness();

    await expect(deliverAnalyticsOutboxBatch({
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: { ANALYTICS_OUTBOX_MODE: 'off' },
      logger: harness.logger,
      posthogClient: harness.posthog,
    })).resolves.toEqual({ blocked: 0, delivered: 0, scanned: 0 });

    expect(harness.em.transactional).not.toHaveBeenCalled();
    expect(harness.posthog.captureBatch).not.toHaveBeenCalled();
  });

  it('claims pending rows with FOR UPDATE SKIP LOCKED and sends the canonical external UUID', async () => {
    const harness = makeHarness();

    await deliverAnalyticsOutboxBatch({
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: liveEnv(),
      logger: harness.logger,
      posthogClient: harness.posthog,
    });

    expect(harness.tx.find).toHaveBeenCalledWith(
      AnalyticsOutbox,
      expect.objectContaining({ sentAt: null }),
      expect.objectContaining({ limit: expect.any(Number), lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE }),
    );
    expect(harness.execute).toHaveBeenCalledWith(
      expect.stringMatching(/for update of outbox, appuser skip locked/i),
      [expect.any(Number)],
    );
    expect(harness.posthog.captureBatch).toHaveBeenCalledWith([
      {
        distinctId: EXTERNAL_USER_ID,
        event: 'signup',
        properties: expect.objectContaining({ $insert_id: `signup.v1:${EXTERNAL_USER_ID}` }),
      },
    ]);
  });

  it('sets sentAt only after the PostHog buffer is acknowledged', async () => {
    const harness = makeHarness();
    harness.posthog.captureBatch.mockImplementationOnce(() => {
      expect(harness.row.sentAt).toBeUndefined();
      return Promise.resolve();
    });

    const result = await deliverAnalyticsOutboxBatch({
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: liveEnv(),
      logger: harness.logger,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      posthogClient: harness.posthog,
    });

    expect(result).toEqual({ blocked: 0, delivered: 1, scanned: 1 });
    expect(harness.row.sentAt).toEqual(new Date('2026-07-14T12:00:00.000Z'));
    expect(harness.tx.flush).toHaveBeenCalledAfter(harness.posthog.captureBatch);
  });

  it('leaves sentAt empty after a PostHog failure and retries with the same insert id', async () => {
    const harness = makeHarness();
    harness.posthog.captureBatch.mockRejectedValueOnce(new Error('posthog unavailable'));
    const deps = {
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: liveEnv(),
      logger: harness.logger,
      posthogClient: harness.posthog,
    };

    await expect(deliverAnalyticsOutboxBatch(deps)).rejects.toThrow('posthog unavailable');
    expect(harness.row.sentAt).toBeUndefined();
    expect(harness.tx.flush).not.toHaveBeenCalled();

    harness.posthog.captureBatch.mockResolvedValueOnce(undefined);
    await expect(deliverAnalyticsOutboxBatch(deps)).resolves.toEqual({ blocked: 0, delivered: 1, scanned: 1 });
    expect(harness.posthog.captureBatch).toHaveBeenNthCalledWith(1, [expect.objectContaining({
      properties: expect.objectContaining({ $insert_id: harness.row.eventId }),
    })]);
    expect(harness.posthog.captureBatch).toHaveBeenNthCalledWith(2, [expect.objectContaining({
      properties: expect.objectContaining({ $insert_id: harness.row.eventId }),
    })]);
  });

  it('fails instead of treating a missing PostHog key as an acknowledgement', async () => {
    const harness = makeHarness();

    await expect(deliverAnalyticsOutboxBatch({
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: { ANALYTICS_OUTBOX_MODE: 'live' },
      logger: harness.logger,
    })).rejects.toThrow('POSTHOG_API_KEY');

    expect(harness.em.transactional).not.toHaveBeenCalled();
    expect(harness.row.sentAt).toBeUndefined();
  });

  it('treats the retired internal-allowlist mode as off', async () => {
    const harness = makeHarness();

    await expect(deliverAnalyticsOutboxBatch({
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: { ANALYTICS_OUTBOX_MODE: 'internal-allowlist', POSTHOG_API_KEY: 'test-key' },
      logger: harness.logger,
      posthogClient: harness.posthog,
    })).resolves.toEqual({ blocked: 0, delivered: 0, scanned: 0 });

    expect(harness.em.transactional).not.toHaveBeenCalled();
  });

  it('never delivers properties containing an email address', async () => {
    const harness = makeHarness({ row: makeRow({ properties: { email: 'ada@example.com' } }) });

    const result = await deliverAnalyticsOutboxBatch({
      em: harness.em as unknown as NonNullable<AnalyticsOutboxDeps>['em'],
      env: liveEnv(),
      logger: harness.logger,
      posthogClient: harness.posthog,
    });

    expect(result).toEqual({ blocked: 1, delivered: 0, scanned: 1 });
    expect(harness.posthog.captureBatch).not.toHaveBeenCalled();
    expect(harness.row.deletedAt).toBeInstanceOf(Date);
  });
});

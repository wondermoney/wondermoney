import { describe, expect, it, vi } from 'vitest';

import { addAccount, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import type { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';

import service from '../account-auto-sync-scheduler.service';

/**
 * When a connection may be synced unattended, judged by the real query against a real Postgres.
 *
 * The rule is an ORM filter over two relations (`Account.enableBankingConnectionKey`), which a
 * mocked EntityManager cannot judge: it returns whatever the test hands it, whatever the `where`
 * says. These tests seed rows and let the database decide, so a condition that is written but
 * never applied fails here.
 */
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-11-10T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

describe('scheduled bank sync eligibility', () => {
  const db = useTestDatabase();
  let sequence = 0;

  async function connection(household: Household, input: { lastSyncAttemptAt?: Date; nextEligibleSyncAt?: Date; refreshedAt?: Date } = {}) {
    sequence += 1;
    const em = db.em();
    const credential = em.create(EnableBankingCredential, {
      applicationId: `app-${sequence}`,
      appuserKey: household.appuser,
      encryptionKeyVersion: 1,
      privateKeyAuthTag: 'tag',
      privateKeyCiphertext: 'ciphertext',
      privateKeyIv: 'iv',
      tenantKey: household.tenant,
    }, { partial: true });
    const created = em.create(EnableBankingConnection, {
      accessValidUntil: new Date(NOW.getTime() + 30 * 24 * HOUR_MS),
      appuserKey: household.appuser,
      aspspCountry: 'PT',
      aspspName: `Bank ${sequence}`,
      enableBankingCredentialKey: credential,
      lastSyncAttemptAt: input.lastSyncAttemptAt,
      nextEligibleSyncAt: input.nextEligibleSyncAt,
      sessionId: `session-${sequence}`,
      state: `state-${sequence}`,
      status: EnableBankingConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    const bankConnection = em.create(BankConnection, {
      accessValidUntil: new Date(NOW.getTime() + 30 * 24 * HOUR_MS),
      appuserKey: household.appuser,
      externalId: `session-${sequence}`,
      lastSyncAttemptAt: input.lastSyncAttemptAt,
      nextEligibleSyncAt: input.nextEligibleSyncAt,
      provider: 'enable_banking',
      state: `state-${sequence}`,
      status: BankConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    created.bankConnectionKey = bankConnection;
    const account = await addAccount(em, household);
    em.assign(account, { bankConnectionKey: bankConnection, refreshedAt: input.refreshedAt });
    await em.flush();
    return bankConnection;
  }

  async function scan() {
    const send = vi.fn().mockResolvedValue('job-id');
    const result = await service.enqueueDueAccountSyncs({
      backgroundOperationService: { attachQueueJob: vi.fn().mockResolvedValue(true), createQueuedOperation: vi.fn().mockResolvedValue({}) },
      bankSyncIncidentService: { allocateIncident: vi.fn().mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }) } as unknown as BankSyncIncidentService,
      now: NOW,
      send,
    });
    const enqueuedConnectionKeys = send.mock.calls.map(([, data]) => (data as { bankConnectionKey: string }).bankConnectionKey);
    return { enqueuedConnectionKeys, result };
  }

  it('syncs a connection whose last attempt is older than the interval', async () => {
    const household = await seedHousehold(db.em());
    const eligible = await connection(household, { lastSyncAttemptAt: hoursAgo(21), refreshedAt: hoursAgo(21) });

    const { enqueuedConnectionKeys, result } = await scan();

    expect(result).toMatchObject({ enqueued: 1, failed: 0 });
    expect(enqueuedConnectionKeys).toEqual([String(eligible.bankConnectionKey)]);
  });

  it('waits out the interval after a failed attempt, even when the last success is much older', async () => {
    const household = await seedHousehold(db.em());
    // The last successful sync was 30 hours ago; the attempt five hours ago failed. Syncing now
    // would spend another of the bank's four daily unattended calls for nothing.
    await connection(household, { lastSyncAttemptAt: hoursAgo(5), refreshedAt: hoursAgo(30) });

    const { result } = await scan();

    expect(result).toMatchObject({ enqueued: 0 });
  });

  it('takes the interval from BANK_SYNC_MIN_INTERVAL_HOURS', async () => {
    vi.stubEnv('BANK_SYNC_MIN_INTERVAL_HOURS', '6');
    try {
      const household = await seedHousehold(db.em());
      const eligible = await connection(household, { lastSyncAttemptAt: hoursAgo(7), refreshedAt: hoursAgo(7) });
      await connection(household, { lastSyncAttemptAt: hoursAgo(5), refreshedAt: hoursAgo(40) });

      const { enqueuedConnectionKeys, result } = await scan();

      expect(result).toMatchObject({ enqueued: 1 });
      expect(enqueuedConnectionKeys).toEqual([String(eligible.bankConnectionKey)]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('defaults to 20 hours, so the same 7-hour-old attempt is not due', async () => {
    const household = await seedHousehold(db.em());
    await connection(household, { lastSyncAttemptAt: hoursAgo(7), refreshedAt: hoursAgo(7) });

    const { result } = await scan();

    expect(result).toMatchObject({ enqueued: 0 });
  });

  it('respects nextEligibleSyncAt for a rate-limited connection', async () => {
    const household = await seedHousehold(db.em());
    await connection(household, { lastSyncAttemptAt: hoursAgo(30), nextEligibleSyncAt: new Date(NOW.getTime() + HOUR_MS), refreshedAt: hoursAgo(30) });
    const eligible = await connection(household, { lastSyncAttemptAt: hoursAgo(30), nextEligibleSyncAt: hoursAgo(1), refreshedAt: hoursAgo(30) });

    const { enqueuedConnectionKeys, result } = await scan();

    expect(result).toMatchObject({ enqueued: 1 });
    expect(enqueuedConnectionKeys).toEqual([String(eligible.bankConnectionKey)]);
  });

  it('leaves a recently synced connection alone when it has no recorded attempt', async () => {
    const household = await seedHousehold(db.em());
    // Rows from before `lastSyncAttemptAt` existed, and connections just linked by an initial sync.
    await connection(household, { refreshedAt: hoursAgo(1) });

    const { result } = await scan();

    expect(result).toMatchObject({ enqueued: 0 });
  });

  it('syncs a never-attempted, never-synced connection', async () => {
    const household = await seedHousehold(db.em());
    const eligible = await connection(household);

    const { enqueuedConnectionKeys, result } = await scan();

    expect(result).toMatchObject({ enqueued: 1 });
    expect(enqueuedConnectionKeys).toEqual([String(eligible.bankConnectionKey)]);
  });

  /** A SimpleFIN connection: its access has no end date, so `accessValidUntil` stays null. */
  async function simplefinConnection(household: Household, input: { lastSyncAttemptAt?: Date; refreshedAt?: Date; status?: BankConnectionStatus } = {}) {
    sequence += 1;
    const em = db.em();
    const bankConnection = em.create(BankConnection, {
      appuserKey: household.appuser,
      externalId: `simplefin:${sequence}`,
      lastSyncAttemptAt: input.lastSyncAttemptAt,
      provider: 'simplefin',
      status: input.status ?? BankConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    const account = await addAccount(em, household);
    em.assign(account, { bankConnectionKey: bankConnection, refreshedAt: input.refreshedAt });
    await em.flush();
    return bankConnection;
  }

  it('syncs a due SimpleFIN connection, which has no access end date, once the operator enables it', async () => {
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking,simplefin');
    try {
      const household = await seedHousehold(db.em());
      const due = await simplefinConnection(household, { lastSyncAttemptAt: hoursAgo(21), refreshedAt: hoursAgo(21) });
      await simplefinConnection(household, { lastSyncAttemptAt: hoursAgo(5), refreshedAt: hoursAgo(30) });
      await simplefinConnection(household, { lastSyncAttemptAt: hoursAgo(30), refreshedAt: hoursAgo(30), status: BankConnectionStatus.REVOKED });

      const { enqueuedConnectionKeys, result } = await scan();

      expect(result).toMatchObject({ enqueued: 1 });
      expect(enqueuedConnectionKeys).toEqual([String(due.bankConnectionKey)]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('never syncs SimpleFIN while BANK_PROVIDERS leaves it out, and still needs an end date from the others', async () => {
    const household = await seedHousehold(db.em());
    await simplefinConnection(household, { lastSyncAttemptAt: hoursAgo(30), refreshedAt: hoursAgo(30) });
    const expiring = await connection(household, { lastSyncAttemptAt: hoursAgo(30), refreshedAt: hoursAgo(30) });
    await db.em().nativeUpdate(BankConnection, { bankConnectionKey: expiring.bankConnectionKey }, { accessValidUntil: null });

    const { result } = await scan();

    expect(result).toMatchObject({ enqueued: 0 });
  });
});

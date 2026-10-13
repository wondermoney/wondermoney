import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { deterministicRequisitionContext } from '@app/analytics/bank-sync-contract';
import { BankRecoveryDelivery } from '@entity/BankRecoveryDelivery';
import { BankSyncFinality, BankSyncResult, BankSyncRolloutMode } from '@entity/BankSyncIncident';
import { BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

const identity = {
  appuserKey: 7,
  correlationId: 'corr-1',
  distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  environment: 'development' as const,
  flow: 'initial-add' as const,
  institutionId: 'safe-bank',
  producer: 'pgboss-initial' as const,
  requisitionId: 'req-1',
  userVisible: true,
};

function harness() {
  const incidents: any[] = [];
  const attempts: any[] = [];
  const deliveries: any[] = [];
  const outbox = vi.fn();
  const transition = vi.fn();
  const tx = {
    create: vi.fn((type: unknown, data: any) => {
      const row = Object.assign(new (type as new () => object)(), data);
      (type === BankSyncIncidentAttempt ? attempts : incidents).push(row);
      return row;
    }),
    find: vi.fn(async (type: unknown, where: any) => {
      const rows = type === BankSyncIncidentAttempt ? attempts : type === BankRecoveryDelivery ? deliveries : incidents;
      return rows.filter((row) => Object.entries(where).every(([key, value]) =>
        key === 'incidentKey' ? row.incidentKey === value : row[key] === value));
    }),
    findOne: vi.fn(async (type: unknown, where: any) => {
      const rows = type === BankSyncIncidentAttempt ? attempts : type === BankRecoveryDelivery ? deliveries : incidents;
      return rows.find((row) => Object.entries(where).every(([key, value]) =>
        key === 'incidentKey' ? row.incidentKey === value : row[key] === value)) ?? null;
    }),
    flush: vi.fn(),
    getReference: vi.fn((_type, key) => key),
    upsert: vi.fn(async (type: unknown, data: any) => {
      const rows = type === BankRecoveryDelivery ? deliveries : incidents;
      const existing = type === BankRecoveryDelivery
        ? deliveries.find((row) => row.incidentKey === data.incidentKey && row.templateVersion === data.templateVersion)
        : incidents.find((row) => row.correlationId === data.correlationId);
      if (existing) return existing;
      const row = Object.assign(new (type as new () => object)(), data);
      if (type === BankRecoveryDelivery) row.bankRecoveryDeliveryKey = deliveries.length + 1;
      rows.push(row);
      return row;
    }),
  };
  const em = { transactional: vi.fn(async (work: (em: any) => unknown) => work(tx)) };
  const service = new BankSyncIncidentService({
    em: em as unknown as EntityManager,
    getDatabaseNow: vi.fn(async () => new Date('2026-07-16T10:00:00Z')),
    recordOutbox: outbox,
    transitionBackgroundOperation: transition,
  });
  return { attempts, deliveries, em, incidents, outbox, service, transition, tx };
}

describe('BankSyncIncidentService', () => {
  it('allocates a missing legacy recovery incident with complete identity', async () => {
    const h = harness();
    const incident = await h.service.completeOrAllocateLegacyIncident(identity);
    expect(incident).toMatchObject({ correlationId: identity.correlationId, distinctId: identity.distinctId, flow: 'initial-add', producer: 'pgboss-initial', userVisible: true });
  });

  it('completes a pristine nullable legacy incident under lock', async () => {
    const h = harness();
    const legacy = { appuserKey: 7, attempts: 0, correlationId: identity.correlationId, finality: BankSyncFinality.NON_TERMINAL, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.PENDING };
    h.incidents.push(legacy);
    await expect(h.service.completeOrAllocateLegacyIncident(identity)).resolves.toMatchObject({ distinctId: identity.distinctId, requisitionId: identity.requisitionId });
  });

  it.each([
    ['initial worker', identity],
    ['scheduled worker', { ...identity, flow: 'scheduled-refresh' as const, producer: 'pgboss-scheduled' as const, userVisible: false }],
    ['admin recovery reconstruction', identity],
  ])('fills only missing visibility for an identity-complete legacy incident from the %s flow', async (_name, input) => {
    const h = harness();
    const legacy = { ...input, attempts: 0, finality: BankSyncFinality.NON_TERMINAL, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.PENDING, userVisible: null };
    h.incidents.push(legacy);
    await expect(h.service.completeOrAllocateLegacyIncident(input)).resolves.toBe(legacy);
    expect(legacy.userVisible).toBe(input.userVisible);
    expect(h.tx.flush).toHaveBeenCalledOnce();
  });

  it('rejects conflicting non-null legacy visibility without mutation', async () => {
    const h = harness();
    const legacy = { ...identity, attempts: 0, finality: BankSyncFinality.NON_TERMINAL, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.PENDING, userVisible: false };
    const before = { ...legacy };
    h.incidents.push(legacy);
    await expect(h.service.completeOrAllocateLegacyIncident(identity)).rejects.toThrow(/different identity|requisition/);
    expect(legacy).toEqual(before);
    expect(h.tx.flush).not.toHaveBeenCalled();
  });

  it.each([
    ['distinctId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    ['environment', 'production'],
    ['flow', 'scheduled-refresh'],
    ['producer', 'pgboss-scheduled'],
    ['requisitionId', 'req-conflict'],
    ['institutionId', 'other-bank'],
  ] as const)('rejects a legacy incident with conflicting non-null %s before mutation', async (field, value) => {
    const h = harness();
    const legacy = { appuserKey: 7, attempts: 0, correlationId: identity.correlationId, [field]: value, finality: BankSyncFinality.NON_TERMINAL, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.PENDING };
    const before = { ...legacy };
    h.incidents.push(legacy);
    await expect(h.service.completeOrAllocateLegacyIncident(identity)).rejects.toThrow(/different identity|requisition/);
    expect(legacy).toEqual(before);
    expect(h.tx.flush).not.toHaveBeenCalled();
  });

  it('fails closed for a conflicting non-pristine nullable legacy incident', async () => {
    const h = harness();
    h.incidents.push({ appuserKey: 7, attempts: 1, correlationId: identity.correlationId, finality: BankSyncFinality.NON_TERMINAL, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.PENDING });
    await expect(h.service.completeOrAllocateLegacyIncident(identity)).rejects.toThrow(/cannot be completed safely/);
  });

  it('reconciles incident-id Task13 history by freezing treatment off at the earliest durable attempt time', async () => {
    const h = harness();
    const incident = { ...identity, attempts: 2, createdAt: new Date('2026-07-01T00:00:00Z'), finality: BankSyncFinality.TERMINAL_FAILURE, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.FAILURE, updatedAt: new Date('2026-07-04T00:00:00Z'), userVisible: null };
    h.incidents.push(incident);
    h.attempts.push(
      { completedAt: new Date('2026-07-03T00:00:00Z'), createdAt: new Date('2026-07-02T00:00:00Z'), incidentKey: incident },
      { createdAt: new Date('2026-07-01T12:00:00Z'), incidentKey: incident },
    );

    await expect(h.service.assertIncident({ correlationId: identity.correlationId, flow: identity.flow, incidentId: incident.incidentId, producer: identity.producer, requisitionId: identity.requisitionId, userVisible: true })).resolves.toBe(incident);
    expect(incident).toMatchObject({ recoveryTreatmentModeCapturedAt: new Date('2026-07-01T12:00:00Z'), recoveryTreatmentModeSnapshot: BankSyncRolloutMode.OFF, userVisible: true });
    expect(h.deliveries).toHaveLength(0);
  });

  it('allows visibility and historical snapshot reconciliation on identity-complete non-pristine rows', async () => {
    const h = harness();
    const incident = { ...identity, attempts: 1, createdAt: new Date('2026-07-01T00:00:00Z'), finality: BankSyncFinality.NON_TERMINAL, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.PARTIAL, updatedAt: new Date('2026-07-02T00:00:00Z'), userVisible: null };
    h.incidents.push(incident);
    await expect(h.service.completeOrAllocateLegacyIncident(identity)).resolves.toBe(incident);
    expect(incident).toMatchObject({ recoveryTreatmentModeCapturedAt: incident.updatedAt, recoveryTreatmentModeSnapshot: BankSyncRolloutMode.OFF, userVisible: true });
  });

  it('reconciles incident-id scheduled history as non-visible and never catches it up to live treatment', async () => {
    const h = harness();
    const scheduled = { ...identity, attempts: 1, createdAt: new Date('2026-07-01T00:00:00Z'), finality: BankSyncFinality.TERMINAL_FAILURE, flow: 'scheduled-refresh' as const, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', producer: 'pgboss-scheduled' as const, result: BankSyncResult.FAILURE, updatedAt: new Date('2026-07-02T00:00:00Z'), userVisible: null };
    h.incidents.push(scheduled);
    await expect(h.service.assertIncident({ correlationId: identity.correlationId, flow: scheduled.flow, incidentId: scheduled.incidentId, producer: scheduled.producer, requisitionId: identity.requisitionId, userVisible: false })).resolves.toBe(scheduled);
    expect(scheduled).toMatchObject({ recoveryTreatmentModeSnapshot: BankSyncRolloutMode.OFF, userVisible: false });
    expect(h.deliveries).toHaveLength(0);
  });

  it('rejects incident-id visibility conflicts without mutation', async () => {
    const h = harness();
    const incident = { ...identity, attempts: 1, finality: BankSyncFinality.TERMINAL_FAILURE, incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result: BankSyncResult.FAILURE, userVisible: false };
    const before = { ...incident };
    h.incidents.push(incident);
    await expect(h.service.assertIncident({ correlationId: identity.correlationId, flow: identity.flow, incidentId: incident.incidentId, producer: identity.producer, requisitionId: identity.requisitionId, userVisible: true })).rejects.toThrow(/visibility|match/);
    expect(incident).toEqual(before);
    expect(h.tx.flush).not.toHaveBeenCalled();
  });

  it('allocates once by correlation and rejects identity/requisition replay mismatch', async () => {
    const h = harness();
    const [first, concurrentReplay] = await Promise.all([
      h.service.allocateIncident(identity),
      h.service.allocateIncident(identity),
    ]);
    expect(concurrentReplay).toBe(first);
    await expect(h.service.allocateIncident({ ...identity, requisitionId: 'req-2' })).rejects.toThrow('identity');
    expect(h.incidents).toHaveLength(1);
    expect(h.tx.upsert).toHaveBeenCalledTimes(2);
    for (const [, candidate] of h.tx.upsert.mock.calls as [unknown, { createdAt?: unknown; updatedAt?: unknown }][]) {
      expect(candidate.createdAt).toBeInstanceOf(Date);
      expect(candidate.updatedAt).toBe(candidate.createdAt);
      expect((candidate.createdAt as Date).toISOString()).toBe('2026-07-16T10:00:00.000Z');
    }
  });

  it('treats a PostgreSQL-hydrated null institution as an omitted institution on replay', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    Object.assign(incident, { institutionId: null });

    await expect(h.service.allocateIncident({ ...identity, institutionId: undefined })).resolves.toBe(incident);
  });

  it('still rejects a non-null institution conflict after PostgreSQL null hydration', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    Object.assign(incident, { institutionId: null });

    await expect(h.service.allocateIncident({ ...identity, institutionId: 'different-bank' })).rejects.toThrow('identity');
  });

  it('appends attempts 1..N, reuses matching pending starts, and rejects conflicts', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    const one = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'job-1' });
    expect(await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'job-1' })).toBe(one);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 2, queueJobId: 'job-1' });
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'recovered-job' });
    expect(h.attempts.map((row) => [row.attempt, row.queueJobId, row.queueAttempt])).toEqual([
      [1, 'job-1', 1], [2, 'job-1', 2], [3, 'recovered-job', 1],
    ]);
    expect(h.attempts.every((row) => row.requisitionContext === deterministicRequisitionContext(identity.requisitionId))).toBe(true);
    expect(h.attempts.every((row) => !Object.hasOwn(row, 'requisitionId'))).toBe(true);
  });

  it('finalizes atomically, writes deterministic outbox once, and runs transition in transaction', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'job-1' });
    const result = await h.service.finalizeAttempt({
      attempt: 1, final: true, incidentId: incident.incidentId, result: 'failed', treatmentMode: 'live',
    });
    expect(result.incident.finality).toBe(BankSyncFinality.TERMINAL_FAILURE);
    expect(result.incident.result).toBe(BankSyncResult.FAILURE);
    expect(result.incident.eligibleAfter?.toISOString()).toBe('2026-07-16T11:00:00.000Z');
    expect(result.scheduleIntent).toEqual({ deliveryKey: 1, eligibleAfter: result.incident.eligibleAfter, incidentId: result.incident.incidentId, templateVersion: 'bank-recovery.v1' });
    expect(h.deliveries).toHaveLength(1);
    expect(h.outbox).toHaveBeenCalledTimes(1);
    expect(h.outbox).toHaveBeenCalledWith(h.tx, expect.objectContaining({ eventName: 'account_add_sync_failed', properties: expect.objectContaining({ contract_version: 'bank-sync.v1' }) }));
    expect(h.transition).toHaveBeenCalledWith(h.tx, expect.objectContaining({ incident: result.incident }));
    await h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: incident.incidentId, result: 'failed', treatmentMode: 'live' });
    expect(h.outbox).toHaveBeenCalledTimes(1);
    expect(h.deliveries).toHaveLength(1);
    expect(await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'job-1' })).toBe(result.attempt);
    await expect(h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: incident.incidentId, institutionId: 'different-bank', result: 'failed', treatmentMode: 'live' })).rejects.toThrow('conflicting completion');
    await expect(h.service.finalizeAttempt({
      attempt: 1, final: true, incidentId: incident.incidentId, result: 'partial', treatmentMode: 'live',
    })).rejects.toThrow('conflicting completion');
  });

  it('normalizes a PostgreSQL-hydrated null incident institution to undefined on the first finalize (RAD-303)', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    Object.assign(incident, { institutionId: null });
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'null-incident-institution' });

    const result = await h.service.finalizeAttempt({ attempt: attempt.attempt, final: true, incidentId: incident.incidentId, result: 'full_success', treatmentEligible: false });
    expect(result.attempt.institutionId).toBeUndefined();
    expect(h.outbox).toHaveBeenCalledWith(h.tx, expect.objectContaining({ properties: expect.objectContaining({ institution_id: undefined }) }));
  });

  it('replays a completed attempt when PostgreSQL hydrates omitted optional fields as null', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'null-optionals' });
    const completed = await h.service.finalizeAttempt({ attempt: attempt.attempt, final: true, incidentId: incident.incidentId, result: 'full_success', treatmentEligible: false });
    Object.assign(attempt, { accountCount: null, errorCategory: null, errorCode: null, institutionId: null });

    await expect(h.service.finalizeAttempt({ attempt: attempt.attempt, final: true, incidentId: incident.incidentId, result: 'full_success', treatmentEligible: false }))
      .resolves.toEqual(completed);
    expect(h.outbox).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['institutionId', 'different-bank'],
    ['errorCategory', 'provider'],
    ['errorCode', 'provider_unavailable'],
    ['accountCount', 0],
  ] as const)('rejects a completed-attempt replay with a real optional %s conflict', async (field, value) => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: `conflicting-${field}` });
    await h.service.finalizeAttempt({ attempt: attempt.attempt, final: true, incidentId: incident.incidentId, result: 'full_success', treatmentEligible: false });
    Object.assign(attempt, { [field]: value });

    await expect(h.service.finalizeAttempt({ attempt: attempt.attempt, final: true, incidentId: incident.incidentId, result: 'full_success', treatmentEligible: false }))
      .rejects.toThrow('conflicting completion');
  });

  it('allows terminal failure to become success, preserves eligibility, and makes success absorbing', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'one' });
    await h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: incident.incidentId, result: 'failed', treatmentMode: 'live' });
    const eligible = incident.eligibleAfter;
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'two' });
    await h.service.finalizeAttempt({ attempt: 2, final: true, incidentId: incident.incidentId, result: 'full_success', treatmentEligible: false });
    expect(incident.finality).toBe(BankSyncFinality.TERMINAL_SUCCESS);
    expect(incident.rolloutMode).toBe('live');
    expect(incident.eligibleAfter).toBe(eligible);
    expect(h.deliveries[0]).toMatchObject({ outcomeCode: 'same_incident_success', status: 'suppressed' });
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'three' });
    await h.service.finalizeAttempt({ attempt: 3, final: false, incidentId: incident.incidentId, result: 'failed', treatmentMode: 'live' });
    expect(incident.finality).toBe(BankSyncFinality.TERMINAL_SUCCESS);
    expect(incident.attempts).toBe(3);
  });

  it('does not catch up an old off decision when rollout later becomes live', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'off' });
    await h.service.finalizeAttempt({ attempt: 1, final: false, incidentId: incident.incidentId, result: 'failed', treatmentMode: null });
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 2, queueJobId: 'later-live' });
    const later = await h.service.finalizeAttempt({ attempt: 2, final: true, incidentId: incident.incidentId, result: 'partial', treatmentMode: 'live' });
    expect(later.scheduleIntent).toBeUndefined();
    expect(incident.eligibleAfter).toBeUndefined();
    expect(h.deliveries).toHaveLength(0);
    expect(incident.recoveryTreatmentModeSnapshot).toBe('off');
  });

  it('freezes first allowlist failure across a later live terminal retry', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'allowlist' });
    await h.service.finalizeAttempt({ attempt: 1, final: false, incidentId: incident.incidentId, result: 'partial', treatmentMode: 'internal-allowlist' });
    const capturedAt = incident.recoveryTreatmentModeCapturedAt;
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 2, queueJobId: 'live' });
    const terminal = await h.service.finalizeAttempt({ attempt: 2, final: true, incidentId: incident.incidentId, result: 'failed', treatmentMode: 'live' });
    expect(incident).toMatchObject({ recoveryTreatmentModeCapturedAt: capturedAt, recoveryTreatmentModeSnapshot: 'internal-allowlist', rolloutMode: 'live' });
    expect(h.deliveries[0]).toMatchObject({ treatmentMode: 'internal-allowlist' });
    expect(terminal.scheduleIntent).toBeDefined();
  });

  it('creates intent for a final initial-add partial, but not scheduled success from another incident', async () => {
    const h = harness();
    const initial = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: initial.incidentId, queueAttempt: 1, queueJobId: 'partial' });
    await h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: initial.incidentId, result: 'partial', treatmentMode: 'internal-allowlist' });
    const scheduled = await h.service.allocateIncident({ ...identity, correlationId: 'other-scheduled', flow: 'scheduled-refresh', producer: 'pgboss-scheduled', userVisible: false });
    await h.service.startAttempt({ incidentId: scheduled.incidentId, queueAttempt: 1, queueJobId: 'scheduled-success' });
    await h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: scheduled.incidentId, result: 'full_success', treatmentMode: null });
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]?.incidentKey).toBe(initial);
    expect(h.deliveries[0]?.status).toBe('pending');
  });

  it('never schedules eligibility for non-terminal or scheduled attempts', async () => {
    for (const [flow, producer] of [['initial-add', 'pgboss-initial'], ['scheduled-refresh', 'pgboss-scheduled']] as const) {
      const h = harness();
      const incident = await h.service.allocateIncident({ ...identity, correlationId: `corr-${flow}`, flow, producer, userVisible: flow === 'initial-add' });
      await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'one' });
      await h.service.finalizeAttempt({ attempt: 1, final: flow === 'scheduled-refresh', incidentId: incident.incidentId, result: 'partial', treatmentMode: 'live' });
      expect(incident.eligibleAfter).toBeUndefined();
    }
  });

  it.each([
    ['full_success', 'account_sync_succeeded'],
    ['failed', 'bank_sync_completed'],
  ] as const)('writes one scheduled %s outbox row named %s', async (result, eventName) => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, correlationId: `scheduled-${result}`, flow: 'scheduled-refresh', producer: 'pgboss-scheduled' });
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: `scheduled-${result}` });
    await h.service.finalizeAttempt({ attempt: attempt.attempt, errorCode: result === 'failed' ? 'provider_unavailable' : undefined, final: result === 'full_success', incidentId: incident.incidentId, result, treatmentEligible: false });
    expect(h.outbox).toHaveBeenCalledTimes(1);
    expect(h.outbox).toHaveBeenCalledWith(h.tx, expect.objectContaining({ eventId: expect.stringMatching(/^bank-sync\.v1:/), eventName, properties: expect.objectContaining({ event_id: expect.stringMatching(/^bank-sync\.v1:/) }) }));
    const outbox = h.outbox.mock.calls[0]?.[1] as { eventId: string; properties: { event_id: string } };
    expect(outbox.eventId).toBe(outbox.properties.event_id);
  });

  it('propagates persistence/outbox failure through the transaction', async () => {
    const h = harness();
    h.outbox.mockRejectedValueOnce(new Error('database unavailable'));
    const incident = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'one' });
    await expect(h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: incident.incidentId, result: 'failed', treatmentEligible: false }))
      .rejects.toThrow('database unavailable');
  });

  it('persists terminal rollout provenance and equal delivery timestamps', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'provenance' });
    await h.service.finalizeAttempt({ attempt: 1, final: true, incidentId: incident.incidentId, result: 'failed', treatmentMode: 'internal-allowlist' });
    expect(incident.rolloutMode).toBe('internal-allowlist');
    expect(h.tx.upsert).toHaveBeenCalledWith(BankRecoveryDelivery, expect.objectContaining({ createdAt: expect.any(Date), updatedAt: expect.any(Date) }), expect.anything());
    const candidate = h.tx.upsert.mock.calls.find(([type]) => type === BankRecoveryDelivery)?.[1] as { createdAt: Date; updatedAt: Date };
    expect(candidate.createdAt).toEqual(candidate.updatedAt);
  });

  it('passes the active transaction context to the database clock query', async () => {
    const h = harness();
    const context = { transaction: 'tx-1' };
    const execute = vi.fn().mockResolvedValue([{ now: new Date('2026-07-16T10:00:00Z') }]);
    Object.assign(h.tx, { getConnection: vi.fn(() => ({ execute })), getTransactionContext: vi.fn(() => context) });
    const service = new BankSyncIncidentService({ em: h.em as unknown as EntityManager, recordOutbox: h.outbox });
    const incident = await service.allocateIncident(identity);
    await service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'job-context' });
    await service.finalizeAttempt({ attempt: 1, errorCategory: 'internal', errorCode: 'internal', final: false, incidentId: incident.incidentId, result: 'failed', treatmentEligible: false });
    expect(execute).toHaveBeenCalledWith('select current_timestamp as now', [], 'all', context);
  });

  it('records a safe pre-enqueue nonterminal versioned attempt', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'pre-enqueue:rejected' });
    await h.service.finalizeAttempt({ attempt: attempt.attempt, errorCategory: 'queue', errorCode: 'queue_unavailable', final: false, incidentId: incident.incidentId, result: 'failed', treatmentEligible: false });
    expect(incident).toMatchObject({ attempts: 1, finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.FAILURE });
    expect(h.attempts).toHaveLength(1);
    expect(incident.eligibleAfter).toBeUndefined();
  });

  it('backfills the incident institution id from the first attempt that learns it (RAD-519)', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    expect(incident.institutionId).toBeUndefined();
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'learns-institution' });
    await h.service.finalizeAttempt({ attempt: attempt.attempt, errorCategory: 'provider', errorCode: 'account_phase_failed', final: false, incidentId: incident.incidentId, institutionId: 'revolut', result: 'failed', treatmentEligible: false });
    expect(incident.institutionId).toBe('revolut');
  });

  it('does not overwrite an already-known incident institution id on a later attempt', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    const one = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'first' });
    await h.service.finalizeAttempt({ attempt: one.attempt, final: false, incidentId: incident.incidentId, institutionId: 'revolut', result: 'failed', treatmentEligible: false });
    const two = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 2, queueJobId: 'second' });
    await h.service.finalizeAttempt({ attempt: two.attempt, final: true, incidentId: incident.incidentId, institutionId: 'a-different-bank', result: 'failed', treatmentEligible: false });
    expect(incident.institutionId).toBe('revolut');
  });

  it('does not conflict a later allocate/reconcile replay against a backfilled institution id (RAD-519)', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident({ ...identity, institutionId: undefined });
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'learns-institution' });
    await h.service.finalizeAttempt({ attempt: attempt.attempt, final: false, incidentId: incident.incidentId, institutionId: 'revolut', result: 'failed', treatmentEligible: false });
    expect(incident.institutionId).toBe('revolut');

    // Real allocate/legacy-reconcile callers never state an institutionId opinion — a replay must
    // still resolve to the same incident instead of throwing an identity conflict.
    await expect(h.service.allocateIncident({ ...identity, institutionId: undefined })).resolves.toBe(incident);
    await expect(h.service.completeOrAllocateLegacyIncident({ ...identity, institutionId: undefined })).resolves.toBe(incident);
  });

  it('normalizes high-cardinality errors across aggregate, attempt, and the single outbox row', async () => {
    const h = harness();
    const incident = await h.service.allocateIncident(identity);
    const attempt = await h.service.startAttempt({ incidentId: incident.incidentId, queueAttempt: 1, queueJobId: 'safe-job' });
    await h.service.finalizeAttempt({ attempt: attempt.attempt, errorCategory: 'person@example.com', errorCode: 'provider-user-123456', final: false, incidentId: incident.incidentId, result: 'failed', treatmentEligible: false });
    expect(incident).toMatchObject({ errorCategory: 'unknown', errorCode: 'unknown' });
    expect(attempt).toMatchObject({ errorCategory: 'unknown', errorCode: 'unknown' });
    expect(h.outbox).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(h.outbox.mock.calls[0]);
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('provider-user-123456');
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

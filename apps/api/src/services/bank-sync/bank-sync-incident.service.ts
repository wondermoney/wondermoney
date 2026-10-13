import { randomUUID } from 'node:crypto';

import type { RequiredEntityData } from '@mikro-orm/core';
import { type EntityManager, LockMode } from '@mikro-orm/core';

import {
  BANK_SYNC_EVENT_NAME,
  type BankSyncContractResult,
  type BankSyncEnvironment,
  buildBankSyncEvent,
  type BankSyncFlow as ContractFlow,
  type BankSyncProducer as ContractProducer,
  deterministicRequisitionContext,
  normalizeBankSyncError,
} from '@app/analytics/bank-sync-contract';
import { Appuser } from '@entity/Appuser';
import {
  BankRecoveryDelivery,
  BankRecoveryDeliveryStatus,
  BankRecoveryTreatmentMode,
} from '@entity/BankRecoveryDelivery';
import {
  BankSyncFinality,
  BankSyncFlow,
  BankSyncIncident,
  BankSyncProducer,
  BankSyncResult,
  BankSyncRolloutMode,
  BankSyncEnvironment as IncidentEnvironment,
} from '@entity/BankSyncIncident';
import { BankSyncAttemptResult, BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';
import { getRef } from '@utils/em-helpers';

/* eslint-disable perfectionist/sort-classes, perfectionist/sort-modules */

const ELIGIBILITY_DELAY_MS = 60 * 60 * 1000;

export interface AllocateBankSyncIncidentInput {
  appuserKey: number;
  correlationId: string;
  distinctId: string;
  environment: BankSyncEnvironment;
  flow: ContractFlow;
  institutionId?: string;
  producer: ContractProducer;
  requisitionId: string;
  userVisible: boolean;
}

export interface StartBankSyncAttemptInput {
  incidentId: string;
  queueAttempt: number;
  queueJobId: string;
  startedAt?: Date;
}

export interface FinalizeBankSyncAttemptInput {
  accountCount?: number;
  attempt: number;
  errorCategory?: string;
  errorCode?: string;
  final: boolean;
  incidentId: string;
  institutionId?: string;
  result: BankSyncContractResult;
  /** Fail-closed rollout snapshot captured by the producer at completion. */
  treatmentMode?: 'internal-allowlist' | 'live' | null;
  /** Transitional compatibility for producers which can only explicitly opt out. */
  treatmentEligible?: false;
}

export interface BankRecoveryScheduleIntent {
  deliveryKey: number;
  eligibleAfter: Date;
  incidentId: string;
  templateVersion: 'bank-recovery.v1';
}

export interface FinalizedBankSyncAttempt {
  attempt: BankSyncIncidentAttempt;
  eventId: string;
  incident: BankSyncIncident;
  scheduleIntent?: BankRecoveryScheduleIntent;
}

export type BankSyncTransitionCallback = (
  em: EntityManager,
  context: Readonly<{
    attempt: BankSyncIncidentAttempt;
    event: ReturnType<typeof buildBankSyncEvent>;
    incident: BankSyncIncident;
  }>,
) => Promise<void>;

interface BankSyncIncidentServiceDependencies {
  em: EntityManager;
  getDatabaseNow?: (em: EntityManager) => Promise<Date>;
  recordOutbox?: typeof recordAnalyticsOutboxEvent;
  transitionBackgroundOperation?: BankSyncTransitionCallback;
}

export class BankSyncIncidentService {
  private readonly em: EntityManager;
  private readonly getDatabaseNow: (em: EntityManager) => Promise<Date>;
  private readonly recordOutbox: typeof recordAnalyticsOutboxEvent;
  private readonly transitionBackgroundOperation?: BankSyncTransitionCallback;

  constructor(dependencies: BankSyncIncidentServiceDependencies) {
    this.em = dependencies.em;
    this.getDatabaseNow = dependencies.getDatabaseNow ?? databaseNow;
    this.recordOutbox = dependencies.recordOutbox ?? recordAnalyticsOutboxEvent;
    this.transitionBackgroundOperation = dependencies.transitionBackgroundOperation;
  }

  async completeOrAllocateLegacyIncident(input: AllocateBankSyncIncidentInput, transaction?: EntityManager): Promise<BankSyncIncident> {
    return this.inTransaction(transaction, async (em) => {
      const incident = await em.findOne(BankSyncIncident, { correlationId: input.correlationId, deletedAt: undefined }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!incident) return this.allocateIncident(input, em);
      assertLegacyKnownIdentity(incident, input);
      const identityComplete = Boolean(incident.distinctId && incident.environment && incident.flow && incident.producer && incident.requisitionId);
      const attempt = await em.findOne(BankSyncIncidentAttempt, { deletedAt: undefined, incidentKey: incident });
      const hasHistory = incident.attempts !== 0 || incident.result !== BankSyncResult.PENDING || Boolean(attempt);
      if (identityComplete) {
        await reconcileTask14Fields(em, incident, input.userVisible, hasHistory);
        assertIncidentIdentity(incident, input);
        return incident;
      }
      if (hasHistory || incident.finality !== BankSyncFinality.NON_TERMINAL) {
        throw new Error('Legacy bank sync incident cannot be completed safely');
      }
      incident.distinctId ??= input.distinctId;
      incident.environment ??= input.environment as IncidentEnvironment;
      incident.flow ??= input.flow as BankSyncFlow;
      incident.institutionId ??= input.institutionId;
      incident.producer ??= input.producer as BankSyncProducer;
      incident.requisitionId ??= input.requisitionId;
      await reconcileTask14Fields(em, incident, input.userVisible, false);
      assertIncidentIdentity(incident, input);
      await em.flush();
      return incident;
    });
  }

  async assertIncident(input: Readonly<{ correlationId: string; flow: ContractFlow; incidentId: string; producer: ContractProducer; requisitionId: string; userVisible: boolean }>): Promise<BankSyncIncident & Required<Pick<BankSyncIncident, 'distinctId' | 'environment' | 'flow' | 'producer' | 'requisitionId'>>> {
    return this.inTransaction(undefined, async (em) => {
      const incident = await this.lockIncident(em, input.incidentId);
      if (incident.correlationId !== input.correlationId || incident.requisitionId !== input.requisitionId
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        || incident.flow !== input.flow || incident.producer !== input.producer) {
        throw new Error('Bank sync job payload does not match its incident');
      }
      assertPersistedContractIdentity(incident);
      const attempt = await em.findOne(BankSyncIncidentAttempt, { deletedAt: undefined, incidentKey: incident });
      const hasHistory = incident.attempts !== 0 || incident.result !== BankSyncResult.PENDING || Boolean(attempt);
      await reconcileTask14Fields(em, incident, input.userVisible, hasHistory);
      return incident;
    });
  }

  async allocateIncident(input: AllocateBankSyncIncidentInput, transaction?: EntityManager): Promise<BankSyncIncident & Required<Pick<BankSyncIncident, 'correlationId' | 'distinctId' | 'environment' | 'flow' | 'producer' | 'requisitionId'>>> {
    return this.inTransaction(transaction, async (em) => {
      let incident = await em.findOne(BankSyncIncident, { correlationId: input.correlationId, deletedAt: undefined });
      if (!incident) {
        const timestamp = await this.getDatabaseNow(em);
        const candidate = {
          appuserKey: getRef(em, Appuser, input.appuserKey),
          attempts: 0,
          correlationId: input.correlationId,
          createdAt: timestamp,
          distinctId: input.distinctId,
          environment: input.environment as IncidentEnvironment,
          finality: BankSyncFinality.NON_TERMINAL,
          flow: input.flow as BankSyncFlow,
          incidentId: randomUUID(),
          institutionId: input.institutionId,
          producer: input.producer as BankSyncProducer,
          requisitionId: input.requisitionId,
          result: BankSyncResult.PENDING,
          rolloutMode: BankSyncRolloutMode.OFF,
          updatedAt: timestamp,
          userVisible: input.userVisible,
        };
        await em.upsert(BankSyncIncident, candidate, {
          onConflictAction: 'ignore',
          onConflictFields: ['correlationId'],
        });
        incident = await em.findOne(BankSyncIncident, { correlationId: input.correlationId, deletedAt: undefined });
      }
      if (!incident) throw new Error('Bank sync incident allocation did not persist');
      assertIncidentIdentity(incident, input);
      assertPersistedContractIdentity(incident);
      return incident;
    });
  }

  async startAttempt(input: StartBankSyncAttemptInput, transaction?: EntityManager): Promise<BankSyncIncidentAttempt> {
    if (!Number.isInteger(input.queueAttempt) || input.queueAttempt <= 0) throw new Error('Bank sync queue attempt must be positive');
    return this.inTransaction(transaction, async (em) => {
      const incident = await this.lockIncident(em, input.incidentId);
      const existing = await em.findOne(BankSyncIncidentAttempt, { deletedAt: undefined, incidentKey: incident, queueAttempt: input.queueAttempt, queueJobId: input.queueJobId });
      if (existing) {
        return existing;
      }
      const attemptNumber = incident.attempts + 1;
      const attempt = em.create(BankSyncIncidentAttempt, {
        attempt: attemptNumber,
        incidentKey: incident,
        queueAttempt: input.queueAttempt,
        queueJobId: input.queueJobId,
        requisitionContext: deterministicRequisitionContext(requiredRequisitionId(incident)),
        startedAt: input.startedAt ?? new Date(),
      } as RequiredEntityData<BankSyncIncidentAttempt>);
      incident.attempts = attemptNumber;
      await em.flush();
      return attempt;
    });
  }

  async finalizeAttempt(input: FinalizeBankSyncAttemptInput, transaction?: EntityManager): Promise<FinalizedBankSyncAttempt> {
    return this.inTransaction(transaction, async (em) => {
      const incident = await this.lockIncident(em, input.incidentId);
      assertPersistedContractIdentity(incident);
      const attempt = await em.findOne(
        BankSyncIncidentAttempt,
        { attempt: input.attempt, deletedAt: undefined, incidentKey: incident },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!attempt) throw new Error('Bank sync attempt was not started');

      const normalizedError = input.result === 'full_success' ? undefined : normalizeBankSyncError({ category: input.errorCategory, code: input.errorCode });
      const event = buildBankSyncEvent({
        account_count: input.accountCount,
        attempt: input.attempt,
        distinct_id: incident.distinctId,
        environment: incident.environment,
        error_category: normalizedError?.error_category,
        error_code: normalizedError?.error_code,
        final: input.final,
        flow: incident.flow,
        incident_id: incident.incidentId,
        // `incident.institutionId` is `nullable: true` in Postgres but typed `string | undefined`
        // by MikroORM, so a row with no value hydrates as `null` at runtime. The contract schema's
        // `institution_id` is `.optional()` (undefined-only, not `.nullable()`), so a stray `null`
        // here throws a ZodError on every attempt and masks the real sync failure — hence the
        // trailing `?? undefined` to normalize null to undefined before it reaches the schema.
        institution_id: input.institutionId ?? incident.institutionId ?? undefined,
        producer: incident.producer,
        requisition_context: deterministicRequisitionContext(incident.requisitionId),
        result: input.result,
      });

      if (attempt.completedAt) {
        if (attempt.eventId !== event.event_id
          // The persistence enum intentionally mirrors the public result union.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          || attempt.result !== input.result || attempt.final !== input.final
          || !optionalEventValueMatches(attempt.institutionId, event.institution_id)
          || !optionalEventValueMatches(attempt.errorCategory, event.error_category)
          || !optionalEventValueMatches(attempt.errorCode, event.error_code)
          || !optionalEventValueMatches(attempt.accountCount, event.account_count)
          || attempt.requisitionContext !== event.requisition_context) throw new Error('Bank sync attempt has a conflicting completion');
        const delivery = await em.findOne(BankRecoveryDelivery, { incidentKey: incident, templateVersion: 'bank-recovery.v1' });
        const schedulable = input.final && input.result !== 'full_success'
          && incident.flow === BankSyncFlow.INITIAL_ADD
          && incident.rolloutMode !== BankSyncRolloutMode.OFF
          && delivery?.status === BankRecoveryDeliveryStatus.PENDING;
        return { attempt, eventId: event.event_id, incident, scheduleIntent: schedulable ? scheduleIntent(delivery, incident.incidentId) : undefined };
      }

      attempt.completedAt = await this.getDatabaseNow(em);
      attempt.accountCount = event.account_count;
      attempt.errorCategory = event.error_category;
      attempt.errorCode = event.error_code;
      attempt.eventId = event.event_id;
      attempt.final = event.final;
      attempt.institutionId = event.institution_id;
      attempt.requisitionContext = event.requisition_context;
      attempt.result = input.result as BankSyncAttemptResult;
      // RAD-519: institution is discovered mid-sync (the requisition/account response), never known
      // at allocation time, so the incident row itself never got it — backfill it here, first value wins.
      incident.institutionId ??= event.institution_id;

      incident.attempts = Math.max(incident.attempts, input.attempt);
      if (input.result !== 'full_success' && !incident.recoveryTreatmentModeSnapshot) {
        incident.recoveryTreatmentModeCapturedAt = attempt.completedAt;
        incident.recoveryTreatmentModeSnapshot = incidentRolloutMode(input.treatmentMode);
      }
      const enteringTerminalFailure = incident.finality !== BankSyncFinality.TERMINAL_FAILURE
        && input.final && input.result !== 'full_success';
      if (enteringTerminalFailure) incident.rolloutMode = incidentRolloutMode(input.treatmentMode);
      applyMonotonicAggregate(incident, { ...input, errorCategory: event.error_category, errorCode: event.error_code }, attempt.completedAt);
      let recoveryDelivery: BankRecoveryDelivery | null = null;
      if (isEligibleTerminalFailure(incident, input, enteringTerminalFailure) && !incident.eligibleAfter) {
        incident.eligibleAfter = new Date(attempt.completedAt.getTime() + ELIGIBILITY_DELAY_MS);
        const timestamp = await this.getDatabaseNow(em);
        await em.upsert(BankRecoveryDelivery, {
          attemptCount: 0,
          createdAt: timestamp,
          eligibleAfter: incident.eligibleAfter,
          incidentKey: incident,
          status: BankRecoveryDeliveryStatus.PENDING,
          templateVersion: 'bank-recovery.v1',
          treatmentMode: recoveryTreatmentMode(incident),
          updatedAt: timestamp,
        }, { onConflictAction: 'ignore', onConflictFields: ['incidentKey', 'templateVersion'] });
        recoveryDelivery = await em.findOne(BankRecoveryDelivery, { incidentKey: incident, templateVersion: 'bank-recovery.v1' });
        if (!recoveryDelivery) throw new Error('Bank recovery delivery intent did not persist');
      } else if (input.result === 'full_success') {
        recoveryDelivery = await em.findOne(BankRecoveryDelivery, { incidentKey: incident, status: BankRecoveryDeliveryStatus.PENDING, templateVersion: 'bank-recovery.v1' }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (recoveryDelivery) {
          recoveryDelivery.completedAt = attempt.completedAt;
          recoveryDelivery.outcomeCode = 'same_incident_success';
          recoveryDelivery.status = BankRecoveryDeliveryStatus.SUPPRESSED;
        }
      }

      await em.flush();
      await this.recordOutbox(em, {
        distinctId: incident.distinctId,
        eventId: event.event_id,
        eventName: bankSyncEventName(incident.flow, event.result),
        properties: event,
      });
      await this.transitionBackgroundOperation?.(em, { attempt, event, incident });
      await em.flush();
      return { attempt, eventId: event.event_id, incident, scheduleIntent: recoveryDelivery?.status === BankRecoveryDeliveryStatus.PENDING ? scheduleIntent(recoveryDelivery, incident.incidentId) : undefined };
    });
  }

  private async inTransaction<T>(transaction: EntityManager | undefined, work: (em: EntityManager) => Promise<T>): Promise<T> {
    return transaction ? work(transaction) : this.em.transactional(work);
  }

  private async lockIncident(em: EntityManager, incidentId: string): Promise<BankSyncIncident> {
    const incident = await em.findOne(
      BankSyncIncident,
      { deletedAt: undefined, incidentId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!incident) throw new Error('Bank sync incident was not found');
    return incident;
  }
}

async function databaseNow(em: EntityManager): Promise<Date> {
  const rows = await em.getConnection().execute<{ now: Date | string }[]>('select current_timestamp as now', [], 'all', em.getTransactionContext());
  const value = rows[0]?.now;
  if (!value) throw new Error('Database did not return current time');
  return value instanceof Date ? value : new Date(value);
}

async function reconcileTask14Fields(em: EntityManager, incident: BankSyncIncident, userVisible: boolean, hasHistory: boolean): Promise<void> {
  if (incident.userVisible != null && incident.userVisible !== userVisible) throw new Error('Bank sync job visibility does not match its incident');
  if ((incident.recoveryTreatmentModeSnapshot == null) !== (incident.recoveryTreatmentModeCapturedAt == null)) {
    throw new Error('Bank sync incident has an incomplete recovery treatment snapshot');
  }
  let changed = false;
  if (incident.userVisible == null) {
    incident.userVisible = userVisible;
    changed = true;
  }
  if (hasHistory && incident.recoveryTreatmentModeSnapshot == null) {
    const attempts = await em.find(BankSyncIncidentAttempt, { deletedAt: undefined, incidentKey: incident });
    const attemptTimes = attempts
      .map((attempt) => attempt.completedAt ?? attempt.createdAt)
      .filter((value): value is Date => value instanceof Date);
    const fallback = incident.updatedAt;
    const capturedAt = attemptTimes.reduce<Date | undefined>((earliest, value) => !earliest || value < earliest ? value : earliest, undefined) ?? fallback;
    if (!(capturedAt instanceof Date)) throw new Error('Legacy bank sync incident has no durable treatment timestamp');
    incident.recoveryTreatmentModeCapturedAt = capturedAt;
    incident.recoveryTreatmentModeSnapshot = BankSyncRolloutMode.OFF;
    changed = true;
  }
  if (changed) await em.flush();
}

function bankSyncEventName(flow: BankSyncFlow, result: BankSyncContractResult): string {
  if (flow === BankSyncFlow.INITIAL_ADD && result !== 'full_success') return 'account_add_sync_failed';
  if (flow === BankSyncFlow.SCHEDULED_REFRESH && result === 'full_success') return 'account_sync_succeeded';
  return BANK_SYNC_EVENT_NAME;
}

function optionalEventValueMatches(persisted: unknown, event: unknown): boolean {
  return persisted === event || (persisted === null && event === undefined);
}

// RAD-519: institution is backfilled onto the incident well after allocation (see finalizeAttempt),
// but no allocation/reconcile caller ever states an institutionId opinion — so an input of `undefined`
// must never conflict with an institution the system already learned. A caller that DOES state a real,
// differing institutionId is still a genuine identity conflict.
function institutionIdentityMatches(persisted: null | string | undefined, input: string | undefined): boolean {
  if (persisted != null && input === undefined) return true;
  return optionalEventValueMatches(persisted, input);
}

function assertIncidentIdentity(incident: BankSyncIncident, input: AllocateBankSyncIncidentInput): void {
  const appuserKey = typeof incident.appuserKey === 'object'
    ? incident.appuserKey.appuserKey
    : incident.appuserKey;
  if (
    appuserKey !== input.appuserKey
    || incident.distinctId !== input.distinctId
    || incident.requisitionId !== input.requisitionId
    // The persistence enums intentionally mirror the public contract unions.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    || incident.flow !== input.flow
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    || incident.producer !== input.producer
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    || incident.environment !== input.environment
    || !institutionIdentityMatches(incident.institutionId, input.institutionId)
    || incident.userVisible !== input.userVisible
  ) throw new Error('Bank sync correlation belongs to a different identity or requisition');
}

function assertLegacyKnownIdentity(incident: BankSyncIncident, input: AllocateBankSyncIncidentInput): void {
  const appuserKey = typeof incident.appuserKey === 'object' ? incident.appuserKey.appuserKey : incident.appuserKey;
  if (appuserKey !== input.appuserKey
    || (incident.distinctId != null && incident.distinctId !== input.distinctId)
    // The persistence enums intentionally mirror the public contract unions.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    || (incident.environment != null && incident.environment !== input.environment)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    || (incident.flow != null && incident.flow !== input.flow)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    || (incident.producer != null && incident.producer !== input.producer)
    || (incident.requisitionId != null && incident.requisitionId !== input.requisitionId)
    // Legacy rows may predate institution tracking entirely (unset) or have it backfilled later by
    // finalizeAttempt (RAD-519) while callers still never state an institutionId opinion — only a
    // real, differing value on both sides is a genuine conflict here.
    || (incident.institutionId != null && input.institutionId != null && incident.institutionId !== input.institutionId)
    || (incident.userVisible != null && incident.userVisible !== input.userVisible)) {
    throw new Error('Bank sync correlation belongs to a different identity or requisition');
  }
}

function requiredRequisitionId(incident: BankSyncIncident): string {
  if (!incident.requisitionId) throw new Error('Legacy bank sync incident is missing requisition identity');
  return incident.requisitionId;
}

function assertPersistedContractIdentity(incident: BankSyncIncident): asserts incident is BankSyncIncident & Required<Pick<BankSyncIncident, 'correlationId' | 'distinctId' | 'environment' | 'flow' | 'producer' | 'requisitionId'>> {
  if (!incident.correlationId || !incident.distinctId || !incident.environment || !incident.flow || !incident.producer || !incident.requisitionId) {
    throw new Error('Legacy bank sync incident is missing contract identity');
  }
}

function applyMonotonicAggregate(
  incident: BankSyncIncident,
  input: FinalizeBankSyncAttemptInput,
  completedAt: Date,
): void {
  if (incident.finality === BankSyncFinality.TERMINAL_SUCCESS) return;
  if (input.result === 'full_success') {
    incident.errorCategory = undefined;
    incident.errorCode = undefined;
    incident.finality = BankSyncFinality.TERMINAL_SUCCESS;
    incident.result = BankSyncResult.SUCCESS;
    incident.successAt ??= completedAt;
    return;
  }
  if (incident.finality === BankSyncFinality.TERMINAL_FAILURE) return;
  incident.errorCategory = input.errorCategory;
  incident.errorCode = input.errorCode;
  incident.result = input.result === 'partial' ? BankSyncResult.PARTIAL : BankSyncResult.FAILURE;
  if (input.final) incident.finality = BankSyncFinality.TERMINAL_FAILURE;
}

function isEligibleTerminalFailure(incident: BankSyncIncident, input: FinalizeBankSyncAttemptInput, enteringTerminalFailure: boolean): boolean {
  return incident.recoveryTreatmentModeSnapshot != null
    && incident.recoveryTreatmentModeSnapshot !== BankSyncRolloutMode.OFF
    && enteringTerminalFailure
    && input.final
    && input.result !== 'full_success'
    && incident.flow === BankSyncFlow.INITIAL_ADD
    && incident.userVisible === true
    && incident.finality === BankSyncFinality.TERMINAL_FAILURE;
}

function recoveryTreatmentMode(incident: BankSyncIncident): BankRecoveryTreatmentMode {
  if (incident.recoveryTreatmentModeSnapshot === BankSyncRolloutMode.INTERNAL_ALLOWLIST) return BankRecoveryTreatmentMode.INTERNAL_ALLOWLIST;
  if (incident.recoveryTreatmentModeSnapshot === BankSyncRolloutMode.LIVE) return BankRecoveryTreatmentMode.LIVE;
  throw new Error('Bank recovery treatment snapshot is not eligible');
}

function incidentRolloutMode(treatmentMode: FinalizeBankSyncAttemptInput['treatmentMode']): BankSyncRolloutMode {
  if (treatmentMode === 'internal-allowlist') return BankSyncRolloutMode.INTERNAL_ALLOWLIST;
  if (treatmentMode === 'live') return BankSyncRolloutMode.LIVE;
  return BankSyncRolloutMode.OFF;
}

function scheduleIntent(delivery: BankRecoveryDelivery, incidentId: string): BankRecoveryScheduleIntent {
  return {
    deliveryKey: delivery.bankRecoveryDeliveryKey,
    eligibleAfter: delivery.eligibleAfter,
    incidentId,
    templateVersion: 'bank-recovery.v1',
  };
}

/* eslint-enable perfectionist/sort-classes, perfectionist/sort-modules */

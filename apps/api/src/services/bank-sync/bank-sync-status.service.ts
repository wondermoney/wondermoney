import type { EntityManager } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { BankSyncIncident, BankSyncResult } from '@entity/BankSyncIncident';
import { NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

/* eslint-disable perfectionist/sort-modules */

export interface BankSyncStatusDto {
  attempts: number;
  errorCategory?: 'authentication' | 'cancelled' | 'consent' | 'data_validation' | 'internal' | 'provider' | 'queue' | 'timeout' | 'unknown';
  errorCode?: 'account_phase_failed' | 'authentication' | 'cancelled' | 'consent_expired' | 'data_validation' | 'institution_unavailable' | 'internal' | 'invalid_requisition' | 'provider_unavailable' | 'queue_unavailable' | 'rate_limited' | 'timeout' | 'transaction_phase_failed' | 'unknown';
  final: boolean;
  incidentId: string;
  result: 'failed' | 'full_success' | 'partial' | 'pending';
  retryable: boolean;
  state: 'failed' | 'partial' | 'processing' | 'succeeded';
}

const ERROR_CATEGORIES = new Set<NonNullable<BankSyncStatusDto['errorCategory']>>(['authentication', 'cancelled', 'consent', 'data_validation', 'internal', 'provider', 'queue', 'timeout', 'unknown']);
const ERROR_CODES = new Set<NonNullable<BankSyncStatusDto['errorCode']>>(['account_phase_failed', 'authentication', 'cancelled', 'consent_expired', 'data_validation', 'institution_unavailable', 'internal', 'invalid_requisition', 'provider_unavailable', 'queue_unavailable', 'rate_limited', 'timeout', 'transaction_phase_failed', 'unknown']);

export class BankSyncStatusService {
  constructor(private readonly em: EntityManager) {}

  async getStatus(incidentId: string, appuser: Appuser): Promise<BankSyncStatusDto> {
    const incident = await this.em.findOne(BankSyncIncident, { appuserKey: appuser, deletedAt: undefined, incidentId });
    if (!incident) throw new NotFoundError('Bank sync incident not found');
    return toPublicStatus(incident);
  }
}

function toPublicStatus(incident: BankSyncIncident): BankSyncStatusDto {
  if (!Number.isSafeInteger(incident.attempts) || incident.attempts < 0) inconsistent(incident, 'attempts is not a non-negative safe integer');

  // MikroORM hydrates nullable columns as `null` (not `undefined`) when an
  // incident is loaded from Postgres, so presence must be checked with a
  // nullish comparison — `!== undefined` alone silently treats every
  // persisted (as opposed to hand-built) incident as if these were set.
  const hasCategory = incident.errorCategory != null;
  const hasCode = incident.errorCode != null;
  if (hasCategory !== hasCode) inconsistent(incident, 'errorCategory/errorCode presence mismatch');
  if (hasCategory && !ERROR_CATEGORIES.has(incident.errorCategory as NonNullable<BankSyncStatusDto['errorCategory']>)) inconsistent(incident, 'errorCategory is not a recognized value');
  if (hasCode && !ERROR_CODES.has(incident.errorCode as NonNullable<BankSyncStatusDto['errorCode']>)) inconsistent(incident, 'errorCode is not a recognized value');

  let final: boolean;
  let result: BankSyncStatusDto['result'];
  let state: BankSyncStatusDto['state'];
  const finality: string = incident.finality;
  if (finality === 'non_terminal') {
    if (incident.result === BankSyncResult.SUCCESS) inconsistent(incident, 'non_terminal finality with SUCCESS result');
    if (incident.result === BankSyncResult.PENDING && (hasCategory || hasCode)) inconsistent(incident, 'PENDING result with an error category/code set');
    if ((incident.result === BankSyncResult.FAILURE || incident.result === BankSyncResult.PARTIAL) && incident.attempts === 0) inconsistent(incident, 'FAILURE/PARTIAL result with zero attempts');
    final = false;
    state = 'processing';
    result = publicResult(incident, incident.result);
  } else if (finality === 'terminal_success') {
    if (incident.result !== BankSyncResult.SUCCESS || incident.attempts === 0 || hasCategory || hasCode) inconsistent(incident, 'terminal_success finality with an inconsistent result/attempts/error state');
    final = true;
    result = 'full_success';
    state = 'succeeded';
  } else if (finality === 'terminal_failure') {
    if ((incident.result !== BankSyncResult.PARTIAL && incident.result !== BankSyncResult.FAILURE) || incident.attempts === 0) inconsistent(incident, 'terminal_failure finality with an inconsistent result/attempts state');
    final = true;
    result = publicResult(incident, incident.result);
    state = incident.result === BankSyncResult.PARTIAL ? 'partial' : 'failed';
  } else {
    inconsistent(incident, `unrecognized finality value: ${finality}`);
  }

  const hasFailure = incident.result === BankSyncResult.FAILURE || incident.result === BankSyncResult.PARTIAL;
  if (hasFailure !== (hasCategory && hasCode)) inconsistent(incident, 'hasFailure does not match error category/code presence');

  return {
    attempts: incident.attempts,
    ...(incident.errorCategory ? {
      errorCategory: incident.errorCategory as BankSyncStatusDto['errorCategory'],
      errorCode: incident.errorCode as BankSyncStatusDto['errorCode'],
    } : {}),
    final,
    incidentId: incident.incidentId,
    result,
    retryable: !final && hasFailure,
    state,
  };
}

function publicResult(incident: BankSyncIncident, result: BankSyncResult): BankSyncStatusDto['result'] {
  if (result === BankSyncResult.PENDING) return 'pending';
  if (result === BankSyncResult.PARTIAL) return 'partial';
  if (result === BankSyncResult.FAILURE) return 'failed';
  return inconsistent(incident, `unrecognized result value: ${result}`);
}

/**
 * This validation trips in production for a small number of incidents and the
 * root cause has not been confidently identified — the aggregation/write logic in
 * `bank-sync-incident.service.ts` is intentionally left untouched. Log the
 * offending incident's full persisted state so the next occurrence is debuggable
 * instead of just a bare error message.
 */
function inconsistent(incident: BankSyncIncident, reason: string): never {
  logger.error(
    {
      incident: {
        attempts: incident.attempts,
        bankSyncIncidentKey: incident.bankSyncIncidentKey,
        errorCategory: incident.errorCategory,
        errorCode: incident.errorCode,
        finality: incident.finality,
        flow: incident.flow,
        incidentId: incident.incidentId,
        result: incident.result,
        rolloutMode: incident.rolloutMode,
        userVisible: incident.userVisible,
      },
      reason,
    },
    'Bank sync incident aggregate is inconsistent',
  );
  throw new Error('Bank sync incident aggregate is inconsistent');
}

/* eslint-enable perfectionist/sort-modules */

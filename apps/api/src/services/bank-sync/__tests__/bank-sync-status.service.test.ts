import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import type { Appuser } from '@entity/Appuser';
import { BankSyncFinality, BankSyncResult } from '@entity/BankSyncIncident';
import { NotFoundError } from '@utils/errors';

import { BankSyncStatusService } from '../bank-sync-status.service';

const INCIDENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = { appuserKey: 7 };

function harness(incident: null | Record<string, unknown>) {
  const em = { findOne: vi.fn().mockResolvedValue(incident) };
  return { em, service: new BankSyncStatusService(em as unknown as EntityManager) };
}

describe('bank sync public status', () => {
  it.each([
    [BankSyncFinality.NON_TERMINAL, BankSyncResult.PENDING, 'processing', 'pending', false],
    [BankSyncFinality.NON_TERMINAL, BankSyncResult.FAILURE, 'processing', 'failed', false],
    [BankSyncFinality.NON_TERMINAL, BankSyncResult.PARTIAL, 'processing', 'partial', false],
    [BankSyncFinality.TERMINAL_SUCCESS, BankSyncResult.SUCCESS, 'succeeded', 'full_success', true],
    [BankSyncFinality.TERMINAL_FAILURE, BankSyncResult.PARTIAL, 'partial', 'partial', true],
    [BankSyncFinality.TERMINAL_FAILURE, BankSyncResult.FAILURE, 'failed', 'failed', true],
  ])('maps %s/%s without exposing persistence data', async (finality, result, state, publicResult, final) => {
    const incident = {
      appuserKey: owner,
      attempts: 2,
      correlationId: 'secret-correlation',
      errorCategory: result === BankSyncResult.PENDING || result === BankSyncResult.SUCCESS ? undefined : 'provider',
      errorCode: result === BankSyncResult.PENDING || result === BankSyncResult.SUCCESS ? undefined : 'provider_unavailable',
      finality,
      incidentId: INCIDENT_ID,
      requisitionId: 'raw-provider-secret',
      result,
    };
    const { service } = harness(incident);

    const dto = await service.getStatus(INCIDENT_ID, owner as unknown as Appuser);

    expect(dto).toEqual({
      attempts: 2,
      ...(incident.errorCategory ? { errorCategory: 'provider', errorCode: 'provider_unavailable' } : {}),
      final,
      incidentId: INCIDENT_ID,
      result: publicResult,
      retryable: !final && (result === BankSyncResult.FAILURE || result === BankSyncResult.PARTIAL),
      state,
    });
    expect(JSON.stringify(dto)).not.toMatch(/secret|correlation|requisition|appuser|tenant|queue|email|institution/i);
  });

  it.each([
    [BankSyncFinality.NON_TERMINAL, BankSyncResult.PENDING, 'processing', 'pending', false],
    [BankSyncFinality.TERMINAL_SUCCESS, BankSyncResult.SUCCESS, 'succeeded', 'full_success', true],
  ])('maps %s/%s when errorCategory/errorCode are hydrated as null', async (finality, result, state, publicResult, final) => {
    // MikroORM hydrates nullable DB columns as `null`, not `undefined`, when
    // an incident is fetched via em.findOne. The rest of this suite's harness
    // builds incidents with `undefined` for absent fields, which never
    // exercised that real hydration shape and let a false-positive
    // `inconsistent()` throw slip into production for every PENDING/
    // terminal_success incident actually read from Postgres.
    const incident = {
      appuserKey: owner,
      attempts: 2,
      correlationId: 'secret-correlation',
      errorCategory: null,
      errorCode: null,
      finality,
      incidentId: INCIDENT_ID,
      requisitionId: 'raw-provider-secret',
      result,
    };
    const { service } = harness(incident);

    const dto = await service.getStatus(INCIDENT_ID, owner as unknown as Appuser);

    expect(dto).toEqual({
      attempts: 2,
      final,
      incidentId: INCIDENT_ID,
      result: publicResult,
      retryable: false,
      state,
    });
  });

  it('owner-scopes the lookup and returns 404 when absent or cross-user', async () => {
    const { em, service } = harness(null);
    await expect(service.getStatus(INCIDENT_ID, owner as unknown as Appuser)).rejects.toBeInstanceOf(NotFoundError);
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      appuserKey: owner,
      deletedAt: undefined,
      incidentId: INCIDENT_ID,
    });
  });

  it.each([
    { attempts: -1, finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.PENDING },
    { attempts: 0, finality: BankSyncFinality.TERMINAL_SUCCESS, result: BankSyncResult.SUCCESS },
    { attempts: 0, errorCategory: 'provider', errorCode: 'provider_unavailable', finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.FAILURE },
    { attempts: 1, errorCategory: 'provider', finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.FAILURE },
    { attempts: 1, errorCode: 'provider_unavailable', finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.FAILURE },
    { attempts: 1, errorCategory: 'provider', errorCode: 'provider_unavailable', finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.PENDING },
    { attempts: 1, errorCategory: 'provider', errorCode: 'provider_unavailable', finality: BankSyncFinality.TERMINAL_SUCCESS, result: BankSyncResult.SUCCESS },
    { attempts: 1, finality: BankSyncFinality.TERMINAL_SUCCESS, result: BankSyncResult.PARTIAL },
    { attempts: 1, finality: BankSyncFinality.TERMINAL_FAILURE, result: BankSyncResult.SUCCESS },
    { attempts: 1, finality: BankSyncFinality.NON_TERMINAL, result: BankSyncResult.SUCCESS },
    { attempts: 1, errorCategory: 'raw provider stack!', errorCode: 'anything', finality: BankSyncFinality.TERMINAL_FAILURE, result: BankSyncResult.FAILURE },
  ])('fails closed for malformed or inconsistent aggregate %#', async (values) => {
    const { service } = harness({ appuserKey: owner, incidentId: INCIDENT_ID, ...values });
    await expect(service.getStatus(INCIDENT_ID, owner as unknown as Appuser)).rejects.toThrow(/inconsistent/i);
  });
});

import type { NextFunction, Request, Response } from 'express';

import {
  bankListByCountryRequestSchema,
  bankSyncStatusRequestSchema,
  startBankConnectionRequestSchema,
  unlinkRequisitionRequestSchema,
} from '@app/validators/banking';
import { zParse } from '@app/validators/parser';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { authedUser } from '@middleware/authed-context';
import { toHttpError } from '@service/bank-providers/http-errors';
import { ENABLE_BANKING_PROVIDER_ID, requireBankProvider } from '@service/bank-providers/registry';
import { BankSyncStatusService } from '@service/bank-sync/bank-sync-status.service';
import { ENABLE_BANKING_CALLBACK_URL } from '@utils/constants';
import { InternalServerError, NotFoundError } from '@utils/errors';

import { DI } from '../app';

export async function getBankList(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    query: { country },
  } = await zParse(bankListByCountryRequestSchema, req);

  // The user's own Enable Banking application, or the instance-wide one when this household may
  // use it (`instance-credential-policy.ts`). Without either, listing banks is refused.
  let institutions;
  try {
    institutions = await requireBankProvider(ENABLE_BANKING_PROVIDER_ID).listInstitutions({ appuserId: user.appuserKey, country, tenantId: req.tenant?.tenantKey });
  } catch (error) {
    throw toHttpError(error);
  }

  return res.json(institutions);
}

export async function getBankSyncStatus(req: Request, res: Response) {
  const user = authedUser(req);
  const { params: { incidentId } } = await zParse(bankSyncStatusRequestSchema, req);
  const status = await new BankSyncStatusService(DI.em).getStatus(incidentId, user);
  return res.status(200).json(status);
}

export async function startBankConnection(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    params: { bankId },
    query: { returnTo },
  } = await zParse(startBankConnectionRequestSchema, req);
  // Fail closed if the request is missing the resolved tenant context. The
  // new connection must dual-write the tenant that the user is
  // operating in, so the controller must never reach the repository without one.
  if (!req.tenant || !Number.isInteger(req.tenant.tenantKey) || req.tenant.tenantKey <= 0) {
    throw new InternalServerError('Authenticated tenant is required to start a bank connection');
  }

  let redirectUrl: string;
  try {
    ({ redirectUrl } = await requireBankProvider(ENABLE_BANKING_PROVIDER_ID).startConnection({
      appuserId: user.appuserKey,
      institutionId: bankId,
      redirectUrl: ENABLE_BANKING_CALLBACK_URL,
      returnTo: returnTo ?? null,
      tenantId: req.tenant.tenantKey,
    }));
  } catch (error) {
    throw toHttpError(error);
  }

  return res.json({ redirectUrl });
}

/**
 * Unlink a bank connection. The route/param name (`requisitionId`) is a legacy name
 * kept for the URL contract; it resolves an `EnableBankingConnection` by its
 * `enableBankingConnectionKey`.
 *
 * Soft-delete only — Enable Banking has no documented session/consent-revocation
 * endpoint, so this stops WonderMoney's own polling/sync but may leave the bank-side consent
 * live until its natural expiry.
 */
export async function unlinkRequisition(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    params: { requisitionId },
  } = await zParse(unlinkRequisitionRequestSchema, req);
  if (!req.tenant || !Number.isInteger(req.tenant.tenantKey) || req.tenant.tenantKey <= 0) {
    throw new InternalServerError('Authenticated tenant is required to unlink a requisition');
  }

  // Owner + tenant + active predicate. A connection created in a
  // different tenant context (legacy or cross-tenant account) is not visible
  // here even if the appuserKey matches.
  const connection = await DI.em.findOne(EnableBankingConnection, {
    appuserKey: user,
    deletedAt: undefined,
    enableBankingConnectionKey: requisitionId,
    tenantKey: req.tenant,
  });
  if (!connection) {
    // Idempotent delete: a duplicate/retried unlink request (double-click, client
    // retry, or a connection already revoked at the bank) can race the first
    // delete and land here after `deletedAt` is already set. The user's desired
    // end state (unlinked) is already true, so treat it as a no-op success
    // instead of surfacing a 404 for something that already happened. Only a
    // connection that never belonged to this (appuser, tenant) is a genuine
    // not-found.
    const existingConnection = await DI.em.findOne(EnableBankingConnection, {
      appuserKey: user,
      enableBankingConnectionKey: requisitionId,
      tenantKey: req.tenant,
    });
    if (existingConnection?.deletedAt) {
      return res.sendStatus(200);
    }
    next(new NotFoundError(`Connection ${requisitionId} not found`));
    return;
  }
  connection.deletedAt = new Date();
  await DI.em.persist(connection).flush();

  return res.sendStatus(200);
}


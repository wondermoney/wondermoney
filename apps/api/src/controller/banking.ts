import { randomUUID } from 'node:crypto';

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
import { BankSyncStatusService } from '@service/bank-sync/bank-sync-status.service';
import { createEnableBankingClient } from '@service/enable-banking/enable-banking-client.service';
import { enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import { ENABLE_BANKING_CALLBACK_URL } from '@utils/constants';
import { decodeEnableBankingInstitutionId, encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';
import { BadRequestError, InternalServerError, NotFoundError } from '@utils/errors';

import { DI } from '../app';

export async function getBankList(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    query: { country },
  } = await zParse(bankListByCountryRequestSchema, req);

  // BYOK: each user's own Enable Banking application, not a shared WonderMoney
  // credential — a user who hasn't registered one in Settings yet can't list banks.
  const credential = await enableBankingCredentialService.getDecryptedCredential(user.appuserKey);
  if (!credential) {
    throw new BadRequestError('No Enable Banking credential configured');
  }

  const client = createEnableBankingClient(credential);
  // Any provider failure here is already one of this app's typed errors (see
  // `enable-banking-client.service.ts`'s `request()` helper) — propagate as-is
  // rather than re-wrapping.
  const institutions = await client.listInstitutions({ country });

  // Enable Banking has no opaque institution id — it identifies a
  // bank by `{name, country}`, so synthesize a stable one for the frontend to hand
  // back on `startBankConnection`. See @utils/enable-banking-institution-id.
  return res.json(
    institutions.map((institution) => ({
      country: institution.country,
      id: encodeEnableBankingInstitutionId({ country: institution.country, name: institution.name }),
      logo: institution.logo ?? '',
      name: institution.name,
    })),
  );
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

  const institutionRef = decodeEnableBankingInstitutionId(bankId);
  if (!institutionRef) {
    throw new BadRequestError('Invalid institution id');
  }

  // BYOK: resolve *this user's* Enable Banking application. `getActiveCredentialEntity`
  // (not the decrypted DTO) is what we need here — `EnableBankingConnection` stores a
  // FK to the credential row, not the key material.
  const credentialEntity = await enableBankingCredentialService.getActiveCredentialEntity(user.appuserKey);
  if (!credentialEntity) {
    throw new BadRequestError('No Enable Banking credential configured');
  }
  const credential = enableBankingCredentialService.decryptCredentialEntity(credentialEntity);
  const client = createEnableBankingClient(credential);

  // `maximum_consent_validity` varies per bank and is never hardcoded — look
  // it up fresh, server-side, rather than trusting a client-supplied value from the
  // earlier `getBankList` response.
  const institutions = await client.listInstitutions({ country: institutionRef.country });
  const institution = institutions.find((candidate) => candidate.name === institutionRef.name);
  if (!institution) {
    throw new NotFoundError('Institution not found');
  }
  const maxConsentValiditySeconds = institution.maximum_consent_validity;
  if (!maxConsentValiditySeconds) {
    throw new InternalServerError('Enable Banking did not return a maximum consent validity for this institution');
  }
  const validUntil = new Date(Date.now() + maxConsentValiditySeconds * 1000).toISOString();

  // The correlation value Enable Banking's callback echoes back.
  const state = randomUUID();

  const authorization = await client.startAuthorization({
    aspsp: { country: institutionRef.country, name: institutionRef.name },
    psuType: 'personal',
    redirectUrl: ENABLE_BANKING_CALLBACK_URL,
    state,
    validUntil,
  });

  await DI.em
    .getRepository(EnableBankingConnection)
    .createConnection(user, req.tenant, credentialEntity, state, institutionRef.name, institutionRef.country, maxConsentValiditySeconds, returnTo ?? null);

  return res.json({ redirectUrl: authorization.url });
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


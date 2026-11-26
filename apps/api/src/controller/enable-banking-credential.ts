import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import { bankKeyActivationFailureReason, bankKeyEventId } from '@service/analytics/bank-key-setup-events';
import { recordServiceEvent } from '@service/analytics/service-events.service';
import { checkEnableBankingCredential } from '@service/enable-banking/enable-banking-application-check';
import { type DecryptedEnableBankingCredential, enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import { ConflictError, ERROR_CODE } from '@utils/errors';
import { activateEnableBankingCredentialRequestSchema, saveEnableBankingCredentialRequestSchema } from '@validators/enable-banking-credential';

/**
 * @description Activate the current user's pending, server-generated Enable Banking key under the
 * application ID Enable Banking assigned its certificate. The pair must pass the signed test call
 * first; an unknown ID, a Sandbox application and a not yet activated one each answer 400 with
 * their own code. 409 `enable_banking_pending_credential_missing` when there is no pending key,
 * or it lapsed.
 */
export async function activateEnableBankingCredential(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    body: { applicationId },
  } = await zParse(activateEnableBankingCredentialRequestSchema, req);

  // Every attempt ends in one service event: activated, or failed with its classified reason.
  const activated = await activatePendingCredential(user.appuserKey, applicationId).catch(async (error: unknown) => {
    await recordServiceEvent(DI.em, user, 'bank_key_activation_failed', { reason: bankKeyActivationFailureReason(error) });
    throw error;
  });
  await recordServiceEvent(DI.em, user, 'bank_key_activated', {}, { eventId: bankKeyEventId('bank_key_activated', activated.credentialKey) });
  return res.json(activated.status);
}

/**
 * @description Generate an RSA key pair for the current user's Enable Banking application and keep
 * it as their pending credential (private key encrypted, never returned). Answers the self-signed
 * certificate to upload in Enable Banking's Control Panel, and when the pending key lapses. Calling
 * it again replaces the pending key, never the active one.
 */
export async function createEnableBankingCertificate(req: Request, res: Response) {
  const user = authedUser(req);
  const certificate = await enableBankingCredentialService.createPendingCredential({ appuser: user, tenant: req.tenant });
  await recordServiceEvent(DI.em, user, 'bank_key_certificate_created', {});
  return res.status(201).json(certificate);
}

/**
 * @description Remove the current user's Enable Banking BYOK credential. Idempotent
 * — calling this when no credential exists (or it was already removed) is a no-op
 * success, not a 404, since the caller's desired end state is already true. The route needs a
 * fresh session, and the authenticator code when two-factor is on (`requireSensitiveSession`).
 */
export async function deleteEnableBankingCredential(req: Request, res: Response) {
  const user = authedUser(req);
  await enableBankingCredentialService.deleteForAppuser(user.appuserKey);
  return res.sendStatus(204);
}

/**
 * @description Get the current user's Enable Banking credential status. Never
 * returns key material — only the non-secret `applicationId` and validation state.
 */
export async function getEnableBankingCredential(req: Request, res: Response) {
  const user = authedUser(req);
  const status = await enableBankingCredentialService.getStatusForAppuser(user.appuserKey);
  return res.json(status);
}

/**
 * @description Validate-then-save the current user's own Enable Banking application
 * credential (BYOK). The credential is proven against Enable Banking's real API
 * (`GET /application`, then `GET /aspsps`) before anything is persisted — a credential that fails validation
 * is never written to the database, encrypted or otherwise, and the raw provider
 * error is never echoed back to the client (it may contain identifying detail we
 * don't control the shape of). The route needs a fresh session, and the authenticator code when
 * two-factor is on (`requireSensitiveSession`).
 */
export async function saveEnableBankingCredential(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    body: { applicationId, privateKeyPem },
  } = await zParse(saveEnableBankingCredentialRequestSchema, req);

  await validateCredential({ applicationId, privateKeyPem });

  const status = await enableBankingCredentialService.saveValidatedCredential({
    applicationId,
    appuser: user,
    privateKeyPem,
    tenant: req.tenant,
  });

  return res.json(status);
}

/** The person's live pending key, checked with the signed test calls, then made their active one. */
async function activatePendingCredential(appuserKey: number, applicationId: string) {
  const pending = await enableBankingCredentialService.getLivePendingCredential(appuserKey);
  if (!pending) {
    throw new ConflictError('There is no Enable Banking key waiting to be activated. Create a new certificate and register it again.', ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING);
  }
  await validateCredential(enableBankingCredentialService.decryptPendingForActivation(pending, applicationId));
  const status = await enableBankingCredentialService.activatePendingCredential(pending, applicationId);
  return { credentialKey: pending.enableBankingCredentialKey, status };
}

/**
 * The signed test calls (`checkEnableBankingCredential`). A wrong application reaches the client
 * only as our own classified 400, never the provider's text; the client has already logged the
 * provider's sanitized error code. An outage at Enable Banking goes on as the client mapped it.
 */
function validateCredential(credential: DecryptedEnableBankingCredential): Promise<void> {
  return checkEnableBankingCredential(credential);
}

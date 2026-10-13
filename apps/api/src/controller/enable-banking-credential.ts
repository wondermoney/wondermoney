import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import { createEnableBankingClient } from '@service/enable-banking/enable-banking-client.service';
import { enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { BadRequestError } from '@utils/errors';
import { saveEnableBankingCredentialRequestSchema } from '@validators/enable-banking-credential';

/**
 * @description Remove the current user's Enable Banking BYOK credential. Idempotent
 * — calling this when no credential exists (or it was already removed) is a no-op
 * success, not a 404, since the caller's desired end state is already true.
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
 * (`GET /aspsps`) before anything is persisted — a credential that fails validation
 * is never written to the database, encrypted or otherwise, and the raw provider
 * error is never echoed back to the client (it may contain identifying detail we
 * don't control the shape of).
 */
export async function saveEnableBankingCredential(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    body: { applicationId, privateKeyPem },
  } = await zParse(saveEnableBankingCredentialRequestSchema, req);

  try {
    const client = createEnableBankingClient({ applicationId, privateKeyPem });
    await client.listInstitutions({});
  } catch (error) {
    const providerResponse = sanitizeProviderResponse(error);
    Sentry.captureException(error, {
      extra: { applicationId, ...(providerResponse ? { providerResponse } : {}) },
      tags: { provider: 'enable_banking', route: 'saveEnableBankingCredential' },
    });
    // Never persist and never echo the raw provider/error message — it may
    // describe the key/application in ways we don't control. A single stable,
    // generic reason is enough for the Settings UI to tell the user their
    // Application ID / private key pair didn't work.
    throw new BadRequestError('Could not validate this Enable Banking credential. Double-check the Application ID and private key and try again.');
  }

  const status = await enableBankingCredentialService.saveValidatedCredential({
    applicationId,
    appuser: user,
    privateKeyPem,
    tenant: req.tenant,
  });

  return res.json(status);
}

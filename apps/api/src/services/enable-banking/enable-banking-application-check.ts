import { isEnableBankingSandboxAllowed } from '@config/enable-banking-instance';
import { BadRequestError, ERROR_CODE } from '@utils/errors';

import { createEnableBankingClient, type EnableBankingClient } from './enable-banking-client.service';
import type { DecryptedEnableBankingCredential } from './enable-banking-credential.service';
import { enableBankingErrorOf } from './enable-banking-error';
import { signEnableBankingJwt } from './enable-banking-jwt.service';

/** Enable Banking's application IDs are UUIDs (`GetApplicationResponse.kid`, "string (uuid4)"). */
const APPLICATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enable Banking's own code for a restricted application with no linked account, from any call. */
const NOT_ACTIVATED_CODES = new Set(['NO_ACCOUNTS_ADDED']);

/** Codes that mean Enable Banking does not accept this key for this `kid`. */
const UNKNOWN_APPLICATION_CODES = new Set(['UNAUTHORIZED_ACCESS', 'WRONG_CREDENTIALS_PROVIDED']);
const UNKNOWN_APPLICATION_STATUSES = new Set([401, 403, 404]);

/** `GET /application` answering these means the endpoint is not there for this application. */
const APPLICATION_ENDPOINT_MISSING_STATUSES = new Set([404, 405]);

export interface CheckEnableBankingCredentialOptions {
  /** Accept a Sandbox application (`ENABLE_BANKING_ALLOW_SANDBOX`, for development). */
  allowSandbox?: boolean;
  /** Builds the client; tests pass a stub. */
  createClient?: (credential: DecryptedEnableBankingCredential) => EnableBankingClient;
}

export class EnableBankingApplicationNotActivatedError extends BadRequestError {
  constructor() {
    super('This Enable Banking application is not activated yet. In the Control Panel, choose "Activate by linking accounts" and link one of your own bank accounts, then try again.', ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_ACTIVATED);
  }
}

export class EnableBankingApplicationNotFoundError extends BadRequestError {
  constructor() {
    super("Enable Banking does not recognise this application ID with this key. Check the ID, that the application was registered with this certificate or key, and that this server's clock is right.", ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND);
  }
}

export class EnableBankingApplicationSandboxError extends BadRequestError {
  constructor() {
    super('This Enable Banking application is a Sandbox application, which never connects to a real bank. Register a Production application instead.', ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX);
  }
}

export class EnableBankingCredentialRefusedError extends BadRequestError {
  constructor() {
    super('Enable Banking refused this key. Try again later, or register the application again.', ERROR_CODE.ENABLE_BANKING_CREDENTIAL_REFUSED);
  }
}

/**
 * The signed test calls a credential must pass before it is saved or activated, so that each wrong
 * application gets its own error:
 *
 * 1. The ID must be a UUID, and the key must sign a JWT; otherwise
 *    {@link EnableBankingApplicationNotFoundError}.
 * 2. `GET /application`, for its `environment`: one other than `PRODUCTION` is a Sandbox
 *    application ({@link EnableBankingApplicationSandboxError}), unless sandboxes are allowed. An
 *    absent field decides nothing, and a 404 or 405 (the endpoint not offered to this application)
 *    skips this step. Its `active` field is not trusted: a Restricted Production application
 *    activated by linking its owner's accounts may not report it.
 * 3. `GET /aspsps`, the check this credential always had to pass.
 *
 * From either call: `NO_ACCOUNTS_ADDED` is {@link EnableBankingApplicationNotActivatedError}; a 401,
 * 403 or 404 with a code saying the key is not accepted is
 * {@link EnableBankingApplicationNotFoundError}; any other 4xx but 429 is
 * {@link EnableBankingCredentialRefusedError}. A rate limit, a timeout or an outage is rethrown as
 * the client mapped it: the application may be fine.
 */
export async function checkEnableBankingCredential(credential: DecryptedEnableBankingCredential, options: CheckEnableBankingCredentialOptions = {}): Promise<void> {
  if (!APPLICATION_ID_PATTERN.test(credential.applicationId)) throw new EnableBankingApplicationNotFoundError();
  try {
    await signEnableBankingJwt(credential.applicationId, credential.privateKeyPem);
  } catch {
    // A pasted PEM that is not an RSA private key: no call can be signed with it.
    throw new EnableBankingApplicationNotFoundError();
  }

  const client = (options.createClient ?? createEnableBankingClient)(credential);
  const allowSandbox = options.allowSandbox ?? isEnableBankingSandboxAllowed();

  let environment: string | undefined;
  try {
    ({ environment } = await client.getApplication());
  } catch (error) {
    if (!APPLICATION_ENDPOINT_MISSING_STATUSES.has(providerStatusOf(error) ?? 0) || isUnknownApplication(error)) throw classifyCallError(error);
  }
  if (environment !== undefined && environment !== 'PRODUCTION' && !allowSandbox) throw new EnableBankingApplicationSandboxError();

  try {
    await client.listInstitutions({});
  } catch (error) {
    throw classifyCallError(error);
  }
}

function classifyCallError(error: unknown): unknown {
  const code = enableBankingErrorOf(error)?.code;
  if (code && NOT_ACTIVATED_CODES.has(code)) return new EnableBankingApplicationNotActivatedError();
  if (isUnknownApplication(error)) return new EnableBankingApplicationNotFoundError();
  const status = providerStatusOf(error);
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) return new EnableBankingCredentialRefusedError();
  return error;
}

function isUnknownApplication(error: unknown): boolean {
  const info = enableBankingErrorOf(error);
  return Boolean(info?.code && UNKNOWN_APPLICATION_CODES.has(info.code) && UNKNOWN_APPLICATION_STATUSES.has(info.status ?? 0));
}

/** The HTTP status Enable Banking answered, as the client recorded it. */
function providerStatusOf(error: unknown): number | undefined {
  return enableBankingErrorOf(error)?.status;
}

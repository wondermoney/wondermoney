import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BadGatewayError, BadRequestError, ERROR_CODE, ForbiddenError, GatewayTimeoutError, InternalServerError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '@utils/errors';

import { checkEnableBankingCredential } from '../enable-banking-application-check';
import type { EnableBankingClient } from '../enable-banking-client.service';

const APPLICATION_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const PRIVATE_KEY_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
const CREDENTIAL = { applicationId: APPLICATION_ID, privateKeyPem: PRIVATE_KEY_PEM };

type Answer = Error | Record<string, unknown> | unknown[];

/** Enable Banking as the client sees it: what `GET /application` and `GET /aspsps` answer. */
function enableBanking(application: Answer, aspsps: Answer = []) {
  const calls: string[] = [];
  const answer = (path: string, value: Answer) => {
    calls.push(path);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  const client = {
    getApplication: () => answer('/application', application),
    listInstitutions: () => answer('/aspsps', aspsps),
  } as unknown as EnableBankingClient;
  return { calls, createClient: () => client };
}

/** A typed error as the Enable Banking client throws it, carrying the provider's own error. */
function providerError<E extends Error>(error: E, status: number, code?: string): E {
  return Object.assign(error, { enableBankingError: { status, ...(code ? { code } : {}) } });
}

const check = (provider: ReturnType<typeof enableBanking>, options: { allowSandbox?: boolean; credential?: typeof CREDENTIAL } = {}) =>
  checkEnableBankingCredential(options.credential ?? CREDENTIAL, { allowSandbox: options.allowSandbox ?? false, createClient: provider.createClient });

/*
 * Each way a person can register the wrong application gets its own answer, so the settings page
 * can say what to fix; an outage at Enable Banking is not one of them, and nothing that Enable
 * Banking has not said outright refuses a working application.
 */
describe('checkEnableBankingCredential', () => {
  it('accepts a Production application that lists banks, whatever it says about being active', async () => {
    const provider = enableBanking({ active: false, environment: 'PRODUCTION' });

    await expect(check(provider)).resolves.toBeUndefined();
    expect(provider.calls).toEqual(['/application', '/aspsps']);
  });

  it('decides nothing from an application answer without an environment', async () => {
    await expect(check(enableBanking({}))).resolves.toBeUndefined();
  });

  it.each([404, 405])('falls back to listing banks when GET /application answers %i', async (status) => {
    const provider = enableBanking(providerError(new NotFoundError('x'), status));

    await expect(check(provider)).resolves.toBeUndefined();
    expect(provider.calls).toEqual(['/application', '/aspsps']);
  });

  it('refuses a Sandbox application, unless sandboxes are allowed', async () => {
    await expect(check(enableBanking({ environment: 'SANDBOX' }))).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX, status: 400 });
    await expect(check(enableBanking({ environment: 'SANDBOX' }), { allowSandbox: true })).resolves.toBeUndefined();
  });

  it.each([
    ['GET /application', enableBanking(providerError(new ForbiddenError('x'), 403, 'NO_ACCOUNTS_ADDED'))],
    ['GET /aspsps', enableBanking({ environment: 'PRODUCTION' }, providerError(new ForbiddenError('x'), 403, 'NO_ACCOUNTS_ADDED'))],
  ])('answers not activated when %s says no accounts were added', async (_call, provider) => {
    await expect(check(provider)).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_ACTIVATED, status: 400 });
  });

  it.each([
    ['Enable Banking does not accept the key for the ID', enableBanking(providerError(new UnauthorizedError('x'), 401, 'UNAUTHORIZED_ACCESS'))],
    ['GET /application 404s because the key is not accepted', enableBanking(providerError(new NotFoundError('x'), 404, 'UNAUTHORIZED_ACCESS'))],
    ['listing banks is refused for the key', enableBanking({}, providerError(new ForbiddenError('x'), 403, 'WRONG_CREDENTIALS_PROVIDED'))],
  ])('answers application not found when %s', async (_case, provider) => {
    await expect(check(provider)).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND, status: 400 });
  });

  it('answers application not found for an ID that is not a UUID, or a key that cannot sign, without asking Enable Banking', async () => {
    const provider = enableBanking({ environment: 'PRODUCTION' });

    await expect(check(provider, { credential: { ...CREDENTIAL, applicationId: 'my-application' } })).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND });
    await expect(check(provider, { credential: { ...CREDENTIAL, privateKeyPem: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----' } })).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND });
    expect(provider.calls).toEqual([]);
  });

  it.each([
    ['a 403 without a code', enableBanking(providerError(new ForbiddenError('x'), 403))],
    ['a 400', enableBanking({}, providerError(new BadRequestError('x'), 400, 'WRONG_REQUEST_PARAMETERS'))],
    ['an unexpected 4xx', enableBanking({}, providerError(new InternalServerError('x'), 422))],
  ])('answers that Enable Banking refused the key for %s', async (_case, provider) => {
    await expect(check(provider)).rejects.toMatchObject({ code: ERROR_CODE.ENABLE_BANKING_CREDENTIAL_REFUSED, status: 400 });
  });

  it.each([
    ['a rate limit', providerError(new TooManyRequestsError('x', 30), 429)],
    ['an outage', providerError(new BadGatewayError('x'), 503)],
    ['a timeout', new GatewayTimeoutError('x')],
  ])('passes %s at Enable Banking through, rather than blaming the application', async (_case, error) => {
    await expect(check(enableBanking(error))).rejects.toBe(error);
    await expect(check(enableBanking({}, error))).rejects.toBe(error);
  });
});

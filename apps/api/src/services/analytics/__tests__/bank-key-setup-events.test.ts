import { createHash, createHmac } from 'node:crypto';

import { ANALYTICS_EVENTS } from '@wondermoney/shared';
import { describe, expect, it } from 'vitest';

import { bankKeyActivationFailureReason, bankKeyEventId } from '@service/analytics/bank-key-setup-events';
import {
  EnableBankingApplicationNotActivatedError,
  EnableBankingApplicationNotFoundError,
  EnableBankingApplicationSandboxError,
  EnableBankingCredentialRefusedError,
} from '@service/enable-banking/enable-banking-application-check';
import { BadGatewayError, ConflictError, ERROR_CODE, GatewayTimeoutError, InternalServerError, ServiceUnavailableError, TooManyRequestsError } from '@utils/errors';

describe('bankKeyActivationFailureReason', () => {
  it.each([
    ['an application ID Enable Banking does not know', new EnableBankingApplicationNotFoundError(), 'application_not_found'],
    ['a Sandbox application', new EnableBankingApplicationSandboxError(), 'application_sandbox'],
    ['an application not activated yet', new EnableBankingApplicationNotActivatedError(), 'application_not_activated'],
    ['another refusal', new EnableBankingCredentialRefusedError(), 'credential_refused'],
    ['no pending key', new ConflictError('gone', ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING), 'pending_credential_missing'],
    ['a rate limit at Enable Banking', new TooManyRequestsError('slow down', 30), 'rate_limited'],
    ['Enable Banking unreachable', new BadGatewayError('down'), 'provider_unavailable'],
    ['Enable Banking timing out', new GatewayTimeoutError('slow'), 'provider_unavailable'],
    ['Enable Banking unavailable', new ServiceUnavailableError('down'), 'provider_unavailable'],
    ['an unexpected answer', new InternalServerError('Unexpected Enable Banking response (418)'), 'unknown'],
    ['a plain error', new Error('socket hang up'), 'unknown'],
    ['an error coded like an inherited property', Object.assign(new Error('x'), { code: 'toString' }), 'unknown'],
    ['something that is not an error', 'refused', 'unknown'],
  ] as const)('reads %s', (_case, error, reason) => {
    expect(bankKeyActivationFailureReason(error)).toBe(reason);
  });

  it('only ever answers a reason the catalogue lists', () => {
    const listed: readonly string[] = ANALYTICS_EVENTS.bank_key_activation_failed.properties.reason.values;
    for (const error of [new EnableBankingApplicationNotFoundError(), new TooManyRequestsError(), new Error('x'), null]) {
      expect(listed).toContain(bankKeyActivationFailureReason(error));
    }
  });
});

describe('bankKeyEventId', () => {
  const SECRET = { BETTER_AUTH_SECRET: 'a-test-auth-secret-of-at-least-32-characters' } as NodeJS.ProcessEnv;
  const OTHER_SECRET = { BETTER_AUTH_SECRET: 'another-test-auth-secret-of-32-characters-or-more' } as NodeJS.ProcessEnv;

  it('is one id per key and event', () => {
    expect(bankKeyEventId('bank_key_activated', 41, SECRET)).toBe(bankKeyEventId('bank_key_activated', 41, SECRET));
    expect(bankKeyEventId('bank_key_activated', 41, SECRET)).not.toBe(bankKeyEventId('bank_key_activated', 42, SECRET));
    expect(bankKeyEventId('bank_key_activated', 41, SECRET)).not.toBe(bankKeyEventId('bank_key_setup_abandoned', 41, SECRET));
    expect(bankKeyEventId('bank_key_setup_abandoned', 41, SECRET)).toMatch(/^bank_key_setup_abandoned\.v1:[0-9a-f]{64}$/u);
  });

  it('cannot be traced back to the sequential key without the server secret', () => {
    const id = bankKeyEventId('bank_key_activated', 41, SECRET).split(':')[1];
    // Someone who knows the scheme but not the secret hashes every small key, plainly or keyed
    // with a guess, and finds no match.
    const guesses = Array.from({ length: 1000 }, (_, key) => `enable-banking-credential:${key}`).flatMap((input) => [
      createHash('sha256').update(input).digest('hex'),
      createHmac('sha256', 'wondermoney-development-secret').update(input).digest('hex'),
    ]);
    expect(guesses).not.toContain(id);
    expect(bankKeyEventId('bank_key_activated', 41, OTHER_SECRET)).not.toBe(bankKeyEventId('bank_key_activated', 41, SECRET));
  });
});

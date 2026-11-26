import { describe, expect, it } from 'vitest';

import { sanitizeProviderResponse } from '@utils/error-sanitizer';

/**
 * The reason this helper exists: an Axios rejection reaches Sentry as
 * "AxiosError: Request failed with status code 409" and nothing else, so every
 * such event looks identical and is undiagnosable. The reason the call failed
 * lives in `response.data`.
 *
 * It is attached to Sentry events on the bank-connection path, so the thing it
 * must never do is leak account details out of a provider payload that echoed
 * the failing request back.
 */

const axiosLike = (status: number, data: unknown) => ({ isAxiosError: true, message: `Request failed with status code ${status}`, response: { data, status } });

describe('sanitizeProviderResponse', () => {
  it('recovers the status and body an Axios error would otherwise hide', () => {
    const result = sanitizeProviderResponse(axiosLike(409, { detail: 'Consent link already used', summary: 'ConsentLinkReused' }));
    expect(result?.status).toBe(409);
    expect(result?.body).toContain('ConsentLinkReused');
  });

  it('redacts account identifiers the provider echoes back', () => {
    // Provider error payloads can quote the request that failed, which on this
    // path carries bank account details.
    const result = sanitizeProviderResponse(axiosLike(400, { detail: 'bad request', iban: 'PT50000201231234567890154' }));
    expect(result?.body).not.toContain('PT50000201231234567890154');
  });

  it('redacts account details a provider quotes inside its message', () => {
    const result = sanitizeProviderResponse(axiosLike(400, { error: 'ASPSP_ERROR', message: 'Account PT50 0002 0123 1234 5678 9015 4 (owner@example.test) has 1,234.56 EUR' }));
    expect(result?.body).toContain('ASPSP_ERROR');
    for (const value of ['PT50 0002', '1234 5678', 'owner@example.test', '1,234.56']) expect(result?.body).not.toContain(value);
  });

  it.each([
    ['an amount in Enable Banking\'s own format', 'balance 98765.43 is too low', '98765.43'],
    ['an amount without thousands separators', 'amount 1234.56 refused', '1234.56'],
    ['an amount with European separators', 'amount 1.234.567,89 refused', '234.567'],
    ['a hyphenated card number', 'card 4111-1111-1111-1111 declined', '4111-1111'],
    ['a spaced card number', 'card 4111 1111 1111 1111 declined', '4111 1111'],
    ['an account number', 'account 0049150005123456 closed', '0049150005123456'],
    ['a lower-case IBAN', 'account es9121000418450200051332 closed', '9121000418450200051332'],
    ['a hyphenated IBAN', 'account ES91-2100-0418-4502-0005-1332 closed', '2100-0418'],
    ['a compact IBAN', 'account ES9121000418450200051332 closed', 'ES91'],
    ['an email address', 'owner owner.name+bank@example.test notified', 'owner.name+bank@example.test'],
  ])('redacts %s', (_case, message, leaked) => {
    const result = sanitizeProviderResponse(axiosLike(400, { message }));
    expect(result?.body).not.toContain(leaked);
    expect(result?.body).toContain('[REDACTED]');
  });

  it.each([
    ['a UUID', 'session 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found'],
    ['a protocol', 'upstream answered HTTP/1.1 502'],
    ['a version', 'client 1.12.0 and api v2.3 are supported'],
    ['an ISO timestamp with fractional seconds', 'at 2026-11-26T09:42:43.960Z the bank timed out'],
    ['an ISO date', 'date_from 2025-11-26 is more than 90 days ago'],
    ['a dotted date', 'consent valid until 26.11.2025'],
    ['short numbers', 'retry in 30 seconds, error 422'],
  ])('keeps %s readable', (_case, message) => {
    const result = sanitizeProviderResponse(axiosLike(422, { message }));
    expect(result?.body).toBe(JSON.stringify({ message }));
  });

  it.each([
    ['a numeric amount', { amount: 1234.56 }],
    ['a whole-number balance', { balance_amount: { amount: 1000 } }],
    ['a balance given as a string', { balanceAfterTransaction: '250' }],
  ])('redacts %s under a money field', (_case, data) => {
    const result = sanitizeProviderResponse(axiosLike(400, data));
    expect(result?.body).not.toMatch(/\d{3}/);
    expect(result?.body).toContain('[REDACTED]');
  });

  it('redacts a long body quickly, cutting it before the patterns run', () => {
    const body = { message: `${'ES91 2100 0418 '.repeat(4000)}${'1'.repeat(20_000)}` };
    const started = performance.now();
    const result = sanitizeProviderResponse(axiosLike(400, body));
    expect(performance.now() - started).toBeLessThan(250);
    expect(result?.body).toContain('[truncated]');
    expect(result?.body).not.toContain('2100 0418');
  });

  it('redacts at depth, not just the top level', () => {
    const result = sanitizeProviderResponse(axiosLike(400, { error: { nested: { iban: 'PT50000201231234567890154' } } }));
    expect(result?.body).not.toContain('PT50000201231234567890154');
  });

  it('caps a runaway body so Sentry does not truncate the whole event', () => {
    // An upstream HTML error page is tens of kilobytes; the useful part is not.
    const result = sanitizeProviderResponse(axiosLike(502, { html: 'x'.repeat(50_000) }));
    expect(result?.body?.length).toBeLessThanOrEqual(2100);
    expect(result?.body).toContain('[truncated]');
  });

  it('returns the status alone when there is no body worth attaching', () => {
    expect(sanitizeProviderResponse({ response: { data: null, status: 503 } })).toEqual({ status: 503 });
    expect(sanitizeProviderResponse({ response: { status: 503 } })).toEqual({ status: 503 });
  });

  it('returns undefined for anything that is not an HTTP failure', () => {
    // Callers spread this conditionally, so undefined must mean "attach nothing"
    // rather than an empty object that shows up as a blank Sentry extra.
    expect(sanitizeProviderResponse(new Error('boom'))).toBeUndefined();
    expect(sanitizeProviderResponse('ConsentLinkReused')).toBeUndefined();
    expect(sanitizeProviderResponse(undefined)).toBeUndefined();
    expect(sanitizeProviderResponse(null)).toBeUndefined();
  });

  it('survives a body that cannot be serialised', () => {
    const circular: Record<string, unknown> = { detail: 'x' };
    circular['self'] = circular;
    expect(() => sanitizeProviderResponse(axiosLike(500, circular))).not.toThrow();
  });
});

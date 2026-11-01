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

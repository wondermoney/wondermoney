import { describe, expect, it } from 'vitest';

import {
  BadRequestError,
  ERROR_CODE,
  ForbiddenError,
  NotFoundError,
  statusToErrorCode,
  TooManyRequestsError,
} from '@utils/errors';

/**
 * `code` is part of the public API contract, so these assertions are deliberately about the
 * literal wire values rather than the constant names — a rename of the constant is free, a
 * change to the emitted string is a breaking change for web and mobile.
 */
describe('error codes', () => {
  it('gives every error a machine-readable code by default', () => {
    expect(new BadRequestError('bad').code).toBe('bad_request');
    expect(new NotFoundError('gone').code).toBe('not_found');
    expect(new ForbiddenError('nope').code).toBe('forbidden');
  });

  it('carries a specific code when one is supplied', () => {
    // A client must be able to tell one 403 apart from another without reading English prose.
    const error = new ForbiddenError('Demo account is read-only', ERROR_CODE.DEMO_READ_ONLY);
    expect(error.code).toBe('demo_read_only');
    expect(error.status).toBe(403);
  });

  it('keeps the message separate from the code', () => {
    // The message is prose for humans and logs; clients branch on the code. Web currently
    // renders the raw English message in preference to its own translated string, which is
    // only fixable once there is a code to branch on.
    const error = new ForbiddenError('Only the household owner can manage the household.', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED);
    expect(error.code).toBe('household_owner_required');
    expect(error.message).toContain('household owner');
  });

  it('preserves retryAfter alongside the code', () => {
    const error = new TooManyRequestsError('slow down', 30);
    expect(error.retryAfter).toBe(30);
    expect(error.code).toBe('RATE_LIMITED');
  });

  it('keeps the rate-limit code in its grandfathered casing', () => {
    // `web/lib/api/rate-limit.ts:18` branches on this exact literal. Normalising it to
    // `rate_limited` would break a live consumer; changing it needs a coordinated release.
    expect(ERROR_CODE.TOO_MANY_REQUESTS).toBe('RATE_LIMITED');
  });

  it('falls back to a status-derived code so the response shape is always uniform', () => {
    // A raw `Error` or a third-party throw reaches the handler without a code. A client
    // should never have to handle "sometimes there is a code".
    expect(statusToErrorCode(404)).toBe('not_found');
    expect(statusToErrorCode(409)).toBe('conflict');
    expect(statusToErrorCode(422)).toBe('validation_failed');
    expect(statusToErrorCode(500)).toBe('internal_error');
    expect(statusToErrorCode(418)).toBe('internal_error');
  });

  it('exposes every specific code as a distinct value', () => {
    const values = Object.values(ERROR_CODE);
    expect(new Set(values).size).toBe(values.length);
  });
});

/**
 * Codes with a known consumer. Renaming one of these is a breaking change for a
 * shipped client — and for mobile in particular, a *silent* one: it does not fail
 * a build or throw, it just stops showing the right error state. This list makes that
 * rename fail here, in the repo that owns the contract, instead of in a store
 * build nobody can hotfix.
 */
describe('codes with a shipped consumer', () => {
  it.each([
    // mobile `lib/api/client.ts` → ApiError('demo-forbidden').
    ['demo_read_only', ERROR_CODE.DEMO_READ_ONLY],
    // web `lib/api/rate-limit.ts`.
    ['RATE_LIMITED', ERROR_CODE.TOO_MANY_REQUESTS],
  ])('still emits %s', (wire, actual) => {
    expect(actual).toBe(wire);
  });
});

describe('code casing', () => {
  it('keeps every code lower_snake except the grandfathered rate limit', () => {
    // Mixed casing is how `RATE_LIMITED` became a permanent exception: nothing
    // stopped it, and by the time it mattered a client had shipped against it.
    const offenders = Object.values(ERROR_CODE)
      .filter((code) => code !== ERROR_CODE.TOO_MANY_REQUESTS)
      .filter((code) => !/^[a-z]+(?:_[a-z]+)*$/.test(code));
    expect(offenders).toEqual([]);
  });
});

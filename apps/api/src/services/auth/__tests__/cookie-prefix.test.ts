import { describe, expect, it } from 'vitest';

import { resolveAuthCookiePrefix } from '../cookie-prefix';

describe('resolveAuthCookiePrefix', () => {
  it('keeps the isolated namespace for the hosted production API', () => {
    expect(resolveAuthCookiePrefix({}, { apiUrl: 'https://api.wonder.money', isProduction: true })).toBe('prod.better-auth');
  });

  it('uses the default namespace for a self-hosted production API, which is what its clients expect', () => {
    expect(resolveAuthCookiePrefix({}, { apiUrl: 'https://api.example.com', isProduction: true })).toBeUndefined();
  });

  it('uses the default namespace outside production', () => {
    expect(resolveAuthCookiePrefix({}, { apiUrl: 'https://api.wonder.money', isProduction: false })).toBeUndefined();
  });

  it('honours an explicit AUTH_COOKIE_PREFIX', () => {
    expect(resolveAuthCookiePrefix({ AUTH_COOKIE_PREFIX: 'casa' }, { apiUrl: 'https://api.example.com', isProduction: true })).toBe('casa');
  });
});

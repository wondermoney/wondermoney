import { describe, expect, it } from 'vitest';

import { resolveAuthCookieDomain } from '../cookie-domain';

const TWO_HOSTS = { apiUrl: 'https://api.example.com', appUrl: 'https://money.example.com' };

describe('resolveAuthCookieDomain', () => {
  it('leaves the cookie host-only when no domain is configured', () => {
    expect(resolveAuthCookieDomain(undefined, TWO_HOSTS)).toBeNull();
    expect(resolveAuthCookieDomain('  ', TWO_HOSTS)).toBeNull();
  });

  it('shares the cookie across the two hostnames of a split install', () => {
    expect(resolveAuthCookieDomain('.example.com', TWO_HOSTS)).toBe('.example.com');
  });

  it('ignores a configured domain when the web app and the API share a hostname', () => {
    // One hostname: a host-only cookie already reaches every path, and a Domain attribute would
    // only widen the session cookie to sibling subdomains.
    expect(resolveAuthCookieDomain('.example.com', {
      apiUrl: 'https://money.example.com',
      appUrl: 'https://money.example.com',
    })).toBeNull();
  });

  it('compares hostnames, not ports or paths', () => {
    expect(resolveAuthCookieDomain('.example.com', {
      apiUrl: 'http://localhost:3001',
      appUrl: 'http://localhost:3000',
    })).toBeNull();
    expect(resolveAuthCookieDomain('.example.com', {
      apiUrl: 'https://money.example.com/api',
      appUrl: 'https://MONEY.example.com',
    })).toBeNull();
  });

  it('keeps the domain when a different hostname is a subdomain of it', () => {
    expect(resolveAuthCookieDomain('.example.com', {
      apiUrl: 'https://api.example.com',
      appUrl: 'https://app.example.com',
    })).toBe('.example.com');
  });
});

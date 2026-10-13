import { describe, expect, it } from 'vitest';

import { defaultBrowserOrigins, resolveInstanceUrls } from '@config/instance-urls';

describe('resolveInstanceUrls', () => {
  it('uses APP_URL and API_URL, without trailing slashes', () => {
    expect(resolveInstanceUrls({ API_URL: 'https://api.example.com/', APP_URL: 'https://money.example.com/' }, 'production')).toEqual({
      apiUrl: 'https://api.example.com',
      appUrl: 'https://money.example.com',
    });
  });

  it('takes the API address from BETTER_AUTH_URL when API_URL is unset', () => {
    expect(resolveInstanceUrls({ APP_URL: 'https://money.example.com', BETTER_AUTH_URL: 'https://api.example.com' }, 'production').apiUrl).toBe('https://api.example.com');
  });

  it('defaults to the local dev servers in development', () => {
    expect(resolveInstanceUrls({}, 'development')).toEqual({ apiUrl: 'http://localhost:3001', appUrl: 'http://localhost:3000' });
  });

  it('refuses to guess the addresses of a deployed instance', () => {
    expect(() => resolveInstanceUrls({ API_URL: 'https://api.example.com' }, 'production')).toThrow(/APP_URL must be set/);
    expect(() => resolveInstanceUrls({ APP_URL: 'https://money.example.com' }, 'staging')).toThrow(/API_URL must be set/);
  });
});

describe('defaultBrowserOrigins', () => {
  it('allows only the app itself in production', () => {
    expect(defaultBrowserOrigins('production', 'https://money.example.com/some/path')).toEqual(['https://money.example.com']);
  });

  it('adds the local dev servers outside production', () => {
    const origins = defaultBrowserOrigins('staging', 'https://staging.example.com');
    expect(origins).toContain('https://staging.example.com');
    expect(origins).toContain('http://localhost:3000');
  });
});

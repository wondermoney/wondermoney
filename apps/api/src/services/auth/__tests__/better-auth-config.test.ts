import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadAuthConfiguration } from '@config/configuration';

import { configuredAppleOptions } from '../apple-options';

const emptyAuth = {
  appleClientId: null,
  appleClientSecret: null,
  appleNativeAudience: null,
  betterAuthSecret: null,
  betterAuthUrl: null,
  cookieDomain: null,
  googleClientId: null,
  googleClientSecret: null,
};

describe('loadAuthConfiguration', () => {
  it('maps the better-auth env keys onto the camelCase auth block', () => {
    const auth = loadAuthConfiguration({
      APPLE_CLIENT_ID: 'apple-web-client',
      APPLE_CLIENT_SECRET: 'apple-secret',
      APPLE_NATIVE_AUDIENCE: 'money.wonder.native',
      AUTH_COOKIE_DOMAIN: '.wonder.money',
      BETTER_AUTH_SECRET: 'better-auth-secret',
      BETTER_AUTH_URL: 'https://api.wonder.money',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    });

    expect(auth).toEqual({
      appleClientId: 'apple-web-client',
      appleClientSecret: 'apple-secret',
      appleNativeAudience: 'money.wonder.native',
      betterAuthSecret: 'better-auth-secret',
      betterAuthUrl: 'https://api.wonder.money',
      cookieDomain: '.wonder.money',
      googleClientId: 'google-client',
      googleClientSecret: 'google-secret',
    });
    expect(Object.isFrozen(auth)).toBe(true);
  });

  it('defaults every optional key to null when absent', () => {
    expect(loadAuthConfiguration({})).toEqual(emptyAuth);
  });

  it('rejects a BETTER_AUTH_URL that is not http(s)', () => {
    expect(() => loadAuthConfiguration({ BETTER_AUTH_URL: 'ftp://api.example.test' })).toThrow(ConfigurationError);
  });
});

describe('configuredAppleOptions with the auth block', () => {
  it('builds Apple options from the camelCase sub-config', () => {
    const auth = loadAuthConfiguration({
      APPLE_CLIENT_ID: 'apple-web-client',
      APPLE_CLIENT_SECRET: 'apple-secret',
      APPLE_NATIVE_AUDIENCE: 'money.wonder.native',
    });

    expect(configuredAppleOptions(auth)).toEqual({
      audience: ['apple-web-client', 'money.wonder.native'],
      clientId: 'apple-web-client',
      clientSecret: 'apple-secret',
    });
  });

  it('returns undefined when Apple credentials are absent', () => {
    expect(configuredAppleOptions(loadAuthConfiguration({}))).toBeUndefined();
  });

  it('configures native-only Apple identity-token verification without a web client secret', () => {
    const auth = loadAuthConfiguration({ APPLE_NATIVE_AUDIENCE: 'money.wonder.app' });

    expect(configuredAppleOptions(auth)).toEqual({
      audience: ['money.wonder.app'],
      clientId: 'money.wonder.app',
    });
  });

  it('keeps the native audience isolated when an explicit web client id is present without a secret', () => {
    expect(configuredAppleOptions({
      appleClientId: 'apple-web-client',
      appleNativeAudience: 'money.wonder.app',
    })).toEqual({
      audience: ['money.wonder.app'],
      clientId: 'apple-web-client',
    });
  });

  it('rejects an orphaned web client secret instead of treating the native bundle id as its client id', () => {
    expect(() => configuredAppleOptions({ appleClientSecret: 'orphan-secret' })).toThrow(ConfigurationError);
    expect(() => configuredAppleOptions({ appleClientId: ' ', appleClientSecret: 'orphan-secret' })).toThrow(ConfigurationError);
    expect(() => configuredAppleOptions({
      appleClientSecret: 'orphan-secret',
      appleNativeAudience: 'money.wonder.app',
    })).toThrow(ConfigurationError);
  });

  it('rejects a blank or wildcard native audience', () => {
    for (const appleNativeAudience of ['', ' ', '*.wonder.money']) {
      expect(() => configuredAppleOptions({ appleNativeAudience })).toThrow(ConfigurationError);
    }
  });

  it('still accepts a process.env-shaped object (compatibility layer)', () => {
    expect(configuredAppleOptions({ APPLE_NATIVE_AUDIENCE: 'money.wonder.native' })).toEqual({
      audience: ['money.wonder.native'],
      clientId: 'money.wonder.native',
    });
    expect(configuredAppleOptions({ APPLE_CLIENT_ID: 'id', APPLE_CLIENT_SECRET: 'secret' })).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    });
  });
});

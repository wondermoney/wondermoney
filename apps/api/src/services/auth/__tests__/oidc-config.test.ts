import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadAuthConfiguration, loadConfiguration } from '@config/configuration';

const oidc = {
  OIDC_CLIENT_ID: 'wondermoney',
  OIDC_CLIENT_SECRET: 'client-secret',
  OIDC_ISSUER: 'https://sso.example.com/application/o/wondermoney/',
};

function issuesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigurationError) return error.issues.map((issue) => issue.path);
    throw error;
  }
  return [];
}

describe('OIDC configuration', () => {
  it('stays off when no OIDC variable is set', () => {
    expect(loadAuthConfiguration({}).oidc).toBeNull();
  });

  it('turns on with the issuer, client id and secret, and fills in the defaults', () => {
    expect(loadAuthConfiguration(oidc).oidc).toEqual({
      adminGroups: [],
      allowedGroups: [],
      allowUnverifiedEmail: false,
      autoSignup: false,
      clientId: 'wondermoney',
      clientSecret: 'client-secret',
      discoveryUrl: 'https://sso.example.com/application/o/wondermoney/.well-known/openid-configuration',
      displayName: 'SSO',
      groupsClaim: 'groups',
      issuer: 'https://sso.example.com/application/o/wondermoney/',
      only: false,
      scopes: ['openid', 'email', 'profile'],
      trustIdpMfa: false,
    });
  });

  it('reads every option', () => {
    const config = loadAuthConfiguration({
      ...oidc,
      OIDC_ADMIN_GROUPS: 'wondermoney-admins',
      OIDC_ALLOW_UNVERIFIED_EMAIL: 'true',
      OIDC_ALLOWED_GROUPS: ' family , friends ,,',
      OIDC_AUTO_SIGNUP: 'yes',
      OIDC_DISPLAY_NAME: 'Authentik',
      OIDC_GROUPS_CLAIM: 'roles',
      OIDC_ISSUER: 'https://sso.example.com/realms/home',
      OIDC_ONLY: '1',
      OIDC_SCOPES: 'openid email profile groups',
      OIDC_TRUST_IDP_MFA: 'on',
    }).oidc;

    expect(config).toMatchObject({
      adminGroups: ['wondermoney-admins'],
      allowedGroups: ['family', 'friends'],
      allowUnverifiedEmail: true,
      autoSignup: true,
      discoveryUrl: 'https://sso.example.com/realms/home/.well-known/openid-configuration',
      displayName: 'Authentik',
      groupsClaim: 'roles',
      only: true,
      scopes: ['openid', 'email', 'profile', 'groups'],
      trustIdpMfa: true,
    });
  });

  it.each([
    [{ OIDC_ISSUER: oidc.OIDC_ISSUER }, ['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']],
    [{ OIDC_CLIENT_ID: 'wondermoney', OIDC_CLIENT_SECRET: 'secret' }, ['OIDC_ISSUER']],
    [{ OIDC_ONLY: 'true' }, ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']],
    [{ OIDC_ADMIN_GROUPS: 'admins' }, ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']],
  ])('refuses a partial configuration and names what is missing (%o)', (source, missing) => {
    expect(issuesOf(() => loadAuthConfiguration(source))).toEqual(missing);
  });

  it('refuses an issuer that is not https, except on a loopback address', () => {
    expect(issuesOf(() => loadAuthConfiguration({ ...oidc, OIDC_ISSUER: 'http://sso.example.com' }))).toEqual(['OIDC_ISSUER']);
    expect(issuesOf(() => loadAuthConfiguration({ ...oidc, OIDC_ISSUER: 'not a url' }))).toEqual(['OIDC_ISSUER']);
    expect(loadAuthConfiguration({ ...oidc, OIDC_ISSUER: 'http://127.0.0.1:9000' }).oidc?.issuer).toBe('http://127.0.0.1:9000');
    expect(loadAuthConfiguration({ ...oidc, OIDC_ISSUER: 'http://localhost:9000' }).oidc?.issuer).toBe('http://localhost:9000');
  });

  it('refuses scopes without openid and a malformed flag', () => {
    expect(issuesOf(() => loadAuthConfiguration({ ...oidc, OIDC_SCOPES: 'email profile' }))).toEqual(['OIDC_SCOPES']);
    expect(issuesOf(() => loadAuthConfiguration({ ...oidc, OIDC_ONLY: 'maybe' }))).toEqual(['OIDC_ONLY']);
  });

  it('fails the API boot the same way', () => {
    const api = {
      ADMIN_API_KEY: 'admin',
      CREDENTIAL_ENCRYPTION_KEY_V1: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
      DB_DATABASE: 'app',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'app',
      EMAIL_OPT_OUT_SIGNING_SECRET: 'opt-out',
      INTERNAL_SERVICE_API_KEY: 'internal',
    };
    expect(issuesOf(() => loadConfiguration('api', { ...api, OIDC_ISSUER: oidc.OIDC_ISSUER }))).toEqual(['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']);
    expect(loadConfiguration('api', { ...api, ...oidc }).auth.oidc?.clientId).toBe('wondermoney');
  });
});

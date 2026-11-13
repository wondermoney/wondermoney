import { describe, expect, it } from 'vitest';

import { aiRequiresVerifiedEmail, verificationLinkLandingOnApp } from '../email-verification-policy';

describe('aiRequiresVerifiedEmail', () => {
  it('is off when unset, so a self-hosted install keeps AI open to every account', () => {
    expect(aiRequiresVerifiedEmail({})).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' yes '])('is on for %j', (value) => {
    expect(aiRequiresVerifiedEmail({ AI_REQUIRES_VERIFIED_EMAIL: value })).toBe(true);
  });

  it.each(['0', 'false', 'off', 'no', ''])('is off for %j', (value) => {
    expect(aiRequiresVerifiedEmail({ AI_REQUIRES_VERIFIED_EMAIL: value })).toBe(false);
  });
});

describe('verificationLinkLandingOnApp', () => {
  const appUrl = 'https://app.example.test';

  it('sends a link with no client callback to the web app instead of the API root', () => {
    const link = verificationLinkLandingOnApp('https://api.example.test/api/auth/verify-email?token=abc&callbackURL=%2F', appUrl);
    const url = new URL(link);
    expect(url.origin).toBe('https://api.example.test');
    expect(url.searchParams.get('token')).toBe('abc');
    expect(url.searchParams.get('callbackURL')).toBe(appUrl);
  });

  it("lands a link with no client callback on the web app's page in the account's locale", () => {
    const link = verificationLinkLandingOnApp('https://api.example.test/api/auth/verify-email?token=abc&callbackURL=%2F', `${appUrl}/`, 'es');
    expect(new URL(link).searchParams.get('callbackURL')).toBe(`${appUrl}/es`);
  });

  it('keeps a callback the client chose', () => {
    const original = `https://api.example.test/api/auth/verify-email?token=abc&callbackURL=${encodeURIComponent(`${appUrl}/en/auth/login`)}`;
    expect(new URL(verificationLinkLandingOnApp(original, appUrl)).searchParams.get('callbackURL')).toBe(`${appUrl}/en/auth/login`);
  });
});

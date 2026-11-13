import { describe, expect, it, vi } from 'vitest';

import { SupportedLanguages } from '@entity/Appuser';

import { authEmailLanguage, linkInAccountLocale } from '../auth-email-language';

const appUrl = 'https://app.example.test';
const user = { email: 'ana@example.test', id: '5f0c1c39-2f7e-4d55-9a57-0d3c7f0e6a11' };
const resetLink = (callback: string) => `https://api.example.test/api/auth/reset-password/T0K3N?callbackURL=${encodeURIComponent(callback)}`;
const callbackOf = (link: string) => new URL(link).searchParams.get('callbackURL');

describe('authEmailLanguage', () => {
  it("uses the account's own language over the page the request came from", async () => {
    const language = await authEmailLanguage({ appUrl, link: resetLink(`${appUrl}/en/auth/reset`), user }, () => Promise.resolve('PT'));

    expect(language).toBe(SupportedLanguages.PT);
  });

  it('uses the sign-up page locale while the account does not exist yet', async () => {
    const link = `https://api.example.test/api/auth/verify-email?token=T0K3N&callbackURL=${encodeURIComponent(`${appUrl}/es`)}`;

    expect(await authEmailLanguage({ appUrl, link, user }, () => Promise.resolve(null))).toBe(SupportedLanguages.ES);
  });

  it('knows no language without an account or a page locale, so the email reads English', async () => {
    for (const callback of ['', '/', 'wondermoney://reset-password', `${appUrl}/auth/reset`, 'https://elsewhere.example.test/pt/auth/reset']) {
      expect(await authEmailLanguage({ appUrl, link: resetLink(callback), user }, () => Promise.resolve(null))).toBeUndefined();
    }
  });

  it('ignores a stored language it does not know', async () => {
    expect(await authEmailLanguage({ appUrl, link: resetLink(''), user }, () => Promise.resolve('FR'))).toBeUndefined();
  });

  it('never throws when the lookup fails, so an existing address answers like any other', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(authEmailLanguage({ appUrl, link: resetLink(`${appUrl}/pt/auth/reset`), user }, lookup)).resolves.toBe(SupportedLanguages.PT);
    await expect(authEmailLanguage({ appUrl, link: resetLink(''), user }, lookup)).resolves.toBeUndefined();
  });
});

describe('linkInAccountLocale', () => {
  it("moves an app callback to the account's locale and leaves the token alone", () => {
    const link = linkInAccountLocale(resetLink(`${appUrl}/en/auth/reset`), appUrl, SupportedLanguages.ES);

    expect(callbackOf(link)).toBe(`${appUrl}/es/auth/reset`);
    expect(new URL(link).pathname).toBe('/api/auth/reset-password/T0K3N');
    expect(new URL(link).origin).toBe('https://api.example.test');
  });

  it("keeps a callback's query and a locale root", () => {
    const verify = `https://api.example.test/api/auth/verify-email?token=T0K3N&callbackURL=${encodeURIComponent(`${appUrl}/en/auth/login?next=%2Fsettings`)}`;
    const moved = linkInAccountLocale(verify, appUrl, SupportedLanguages.PT);

    expect(callbackOf(moved)).toBe(`${appUrl}/pt/auth/login?next=%2Fsettings`);
    expect(new URL(moved).searchParams.get('token')).toBe('T0K3N');
    expect(callbackOf(linkInAccountLocale(resetLink(`${appUrl}/pt`), appUrl, SupportedLanguages.ES))).toBe(`${appUrl}/es`);
  });

  it('works under an app served from a sub-path', () => {
    const base = 'https://example.test/money/';
    const link = linkInAccountLocale(resetLink('https://example.test/money/en/auth/reset'), base, SupportedLanguages.PT);

    expect(callbackOf(link)).toBe('https://example.test/money/pt/auth/reset');
  });

  it('leaves the mobile scheme, other sites and paths without a locale as they are', () => {
    for (const callback of ['wondermoney://reset-password', 'https://elsewhere.example.test/en/auth/reset', `${appUrl}/auth/reset`, '']) {
      const link = resetLink(callback);
      expect(linkInAccountLocale(link, appUrl, SupportedLanguages.PT)).toBe(link);
    }
  });
});

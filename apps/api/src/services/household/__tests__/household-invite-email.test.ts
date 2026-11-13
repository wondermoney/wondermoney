import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  fireAndForget: vi.fn(),
  sendRenderedEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/email/email', () => ({ sendRenderedEmail: mocked.sendRenderedEmail }));
vi.mock('@utils/fire-and-forget', () => ({ fireAndForget: mocked.fireAndForget }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { HouseholdRole } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';

import { createHouseholdInvite, resendHouseholdInvite } from '../household-invite.service';

/*
 * The invite email: in the inviter's language, linking only to the join page with its own token,
 * and safe from an inviter's display name (the recipient is attacker-chosen and the mail is signed
 * by the instance's own domain, so an unescaped name is a phishing primitive).
 */
describe('the household invite email', () => {
  const db = useTestDatabase();
  let owner: Appuser;
  let tenant: Tenant;

  beforeEach(async () => {
    vi.clearAllMocks();
    const household = await seedHousehold(db.em());
    owner = household.appuser;
    tenant = household.tenant;
  });

  async function inviteAs(changes: Partial<Appuser>, email = 'partner@example.com') {
    const em = db.em();
    const inviter = await em.findOneOrFail(Appuser, { appuserKey: owner.appuserKey });
    Object.assign(inviter, changes);
    return createHouseholdInvite(em, inviter, HouseholdRole.OWNER, await em.findOneOrFail(Tenant, { tenantKey: tenant.tenantKey }), email);
  }

  /** The email the invite sent, once its fire-and-forget send has run. */
  const sentEmail = async () => {
    await Promise.all(mocked.fireAndForget.mock.calls.map((call: unknown[]) => call[0] as Promise<unknown>));
    return (mocked.sendRenderedEmail.mock.calls as unknown as [{ html: string; subject: string; text: string; to: { email: string } }][]).at(-1)?.[0] ?? { html: '', subject: '', text: '', to: { email: '' } };
  };

  it.each([
    [SupportedLanguages.PT, 'pt'],
    [SupportedLanguages.ES, 'es'],
    [SupportedLanguages.EN, 'en'],
  ])('writes an invite from a %s account in %s and opens the join page in that locale', async (language, locale) => {
    const invite = await inviteAs({ firstName: 'Ada', language });

    const { html, subject, text } = await sentEmail();
    expect(html).toMatch(new RegExp(`<html[^>]*lang="${locale}"`, 'u'));
    expect(text).toContain(`/${locale}/join?token=${invite.token}`);
    expect(subject).toContain('Ada');
  });

  it('resends in the language of the inviter who resends it, with a new link', async () => {
    const invite = await inviteAs({ firstName: 'Ada' });
    const oldToken = invite.token;
    const em = db.em();
    const resender = await em.findOneOrFail(Appuser, { appuserKey: owner.appuserKey });
    resender.language = SupportedLanguages.ES;

    const resent = await resendHouseholdInvite(em, resender, HouseholdRole.OWNER, await em.findOneOrFail(Tenant, { tenantKey: tenant.tenantKey }), invite.householdInviteKey);

    const { html, text } = await sentEmail();
    expect(html).toMatch(/<html[^>]*lang="es"/u);
    expect(text).toContain(`/es/join?token=${resent.token}`);
    expect(text).not.toContain(`token=${oldToken}`);
  });

  it('escapes markup in the inviter display name instead of shipping it into the email body', async () => {
    await inviteAs({ firstName: '<a href="https://evil.tld/login">Security Alert</a>' }, 'victim@example.com');

    const { html } = await sentEmail();
    expect(html).not.toContain('<a href="https://evil.tld/login">');
    expect(html).not.toContain('href="https://evil.tld');
  });

  it('keeps the invite link intact, and links nowhere the invite does not', async () => {
    const invite = await inviteAs({ firstName: 'Ada' });

    const { html, text, to } = await sentEmail();
    expect(to.email).toBe('partner@example.com');
    expect(html).toContain(`/join?token=${invite.token}`);
    expect(text).toContain(`/join?token=${invite.token}`);
    const appOrigin = new URL(process.env['APP_URL'] ?? '').origin;
    const hrefs = [...html.matchAll(/href="([^"]+)"/gu)].map(([, href = '']) => new URL(href.replaceAll('&amp;', '&')));
    const withToken = hrefs.filter((href) => href.searchParams.has('token'));
    expect(withToken.length).toBeGreaterThan(0);
    expect(withToken.every((href) => href.searchParams.get('token') === invite.token && href.origin === appOrigin)).toBe(true);
  });

  it('falls back to the inviter email address and escapes that too', async () => {
    await inviteAs({ emailAddress: '"><script>alert(1)</script>@wonder.money', firstName: undefined }, 'victim@example.com');

    expect((await sentEmail()).html).not.toContain('<script>');
  });
});

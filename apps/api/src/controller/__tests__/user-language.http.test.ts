import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import userRoutes from '@route/user';

/*
 * The account language is what emails and the other server-written texts go out in. The web and
 * mobile language pickers set it with the profile update, so a person who picks Español gets
 * Spanish where the copy exists.
 */
describe('PATCH /v1/user/:userId language', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/user', userRoutes);

  const languageOf = async (appuser: Appuser) => (await db.em().findOne(Appuser, { appuserKey: appuser.appuserKey }))?.language;

  it.each([SupportedLanguages.ES, SupportedLanguages.PT, SupportedLanguages.EN])('sets the account language to %s', async (language) => {
    const { appuser } = await seedHousehold(db.em());

    const response = await http.as(appuser).patch(`/v1/user/${appuser.externalUserId}`).send({ language });

    expect(response.status).toBe(200);
    expect(await languageOf(appuser)).toBe(language);
  });

  it('refuses a language the server writes nothing in and keeps the old one', async () => {
    const { appuser } = await seedHousehold(db.em());

    const response = await http.as(appuser).patch(`/v1/user/${appuser.externalUserId}`).send({ language: 'FR' });

    expect(response.status).toBe(400);
    expect(await languageOf(appuser)).toBe(SupportedLanguages.EN);
  });

  it('changes only the caller, whatever the path names', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);

    const response = await http.as(partner).patch(`/v1/user/${household.appuser.externalUserId}`).send({ language: SupportedLanguages.ES });

    expect(response.status).toBe(200);
    expect(await languageOf(partner)).toBe(SupportedLanguages.ES);
    expect(await languageOf(household.appuser)).toBe(SupportedLanguages.EN);
  });

  it('leaves the language alone when a profile update does not name one', async () => {
    const { appuser } = await seedHousehold(db.em());
    await http.as(appuser).patch(`/v1/user/${appuser.externalUserId}`).send({ language: SupportedLanguages.ES });

    const response = await http.as(appuser).patch(`/v1/user/${appuser.externalUserId}`).send({ firstName: 'Ana' });

    expect(response.status).toBe(200);
    expect(await languageOf(appuser)).toBe(SupportedLanguages.ES);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { HouseholdRole } from '@entity/AppuserTenant';
import { Tag } from '@entity/Tag';
import tagRoutes from '@route/tag';
import userRoutes from '@route/user';
import { createApiToken } from '@service/api-token/api-token.service';
import { ERROR_CODE } from '@utils/errors';

/*
 * Through the real authenticated-tenant stack: a viewer sees the household's data and changes none
 * of it, with a session or with a personal API token, while keeping their own settings.
 */
describe('a household viewer over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const tags = tenantHttp('/v1/tag', tagRoutes);
  const user = tenantHttp('/v1/user', userRoutes);

  let household: Household;
  let viewer: Appuser;
  let member: Appuser;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    viewer = await addPartner(db.em(), household, { role: HouseholdRole.VIEWER });
    member = await addPartner(db.em(), household, { role: HouseholdRole.MEMBER });
  });

  const storedTags = () => db.em().find(Tag, {}, { filters: false });

  it('reads the shared data but cannot change it', async () => {
    expect((await tags.as(member).post('/v1/tag').send({ name: 'Holiday' })).status).toBe(201);
    const tag = await db.em().findOneOrFail(Tag, { name: 'Holiday' }, { filters: false });

    expect((await tags.as(viewer).get('/v1/tag')).body.tags).toEqual([expect.objectContaining({ name: 'Holiday' })]);
    for (const attempt of [
      tags.as(viewer).post('/v1/tag').send({ name: 'Viewer tag' }),
      tags.as(viewer).patch(`/v1/tag/${tag.tagKey}`).send({ name: 'Renamed' }),
      tags.as(viewer).delete(`/v1/tag/${tag.tagKey}`),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ERROR_CODE.HOUSEHOLD_READ_ONLY);
    }
    expect((await storedTags()).map((stored) => [stored.name, stored.deletedAt ?? null])).toEqual([['Holiday', null]]);
  });

  it('is read-only with a personal write token too', async () => {
    const { token } = await createApiToken({ appuser: viewer, expiresInDays: 30, name: 'Script', scopes: ['read', 'write'], tenant: household.tenant }, db.em());

    const response = await tags.asToken(token).post('/v1/tag').send({ name: 'From a script' });

    expect(response.status).toBe(403);
    expect(await storedTags()).toEqual([]);
  });

  it('keeps their own preferences', async () => {
    const response = await user.as(viewer).patch('/v1/user/me/preferences').send({ hideAi: true });
    expect(response.status).not.toBe(403);
  });
});

import type { EntityManager } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { ApiToken } from '@entity/ApiToken';
import accountRoutes from '@route/account';
import categoryRoutes from '@route/category';
import configsRoutes from '@route/configs';
import householdRoutes from '@route/household';
import userRoutes from '@route/user';
import { createApiToken, hashApiToken } from '@service/api-token/api-token.service';
import logger from '@utils/logger';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () =>
  (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession(),
);

const db = useTestDatabase();
useRequestContextEm(db);

const accountHttp = tenantHttp('/v1/account', accountRoutes);
const categoryHttp = tenantHttp('/v1/category', categoryRoutes);
const configsHttp = tenantHttp('/v1/configs', configsRoutes);
const userHttp = tenantHttp('/v1/user', userRoutes);
const householdHttp = tenantHttp('/v1/household', householdRoutes);

describe('personal API tokens over HTTP', () => {
  let em: EntityManager;
  let household: Household;
  let partner: Awaited<ReturnType<typeof addPartner>>;

  beforeEach(async () => {
    em = db.em();
    household = await seedHousehold(em);
    partner = await addPartner(em, household);
  });

  async function tokenFor(
    scopes: ('read' | 'write')[],
    appuser = household.appuser,
    expiresInDays: 30 | 90 | 365 = 30,
  ): Promise<string> {
    const { token } = await createApiToken(
      { appuser, expiresInDays, name: 'Test token', scopes, tenant: household.tenant },
      em,
    );
    return token;
  }

  it('reads data with a read token', async () => {
    await addAccount(em, household, { name: 'Shared account' });
    const token = await tokenFor(['read']);

    const response = await accountHttp.asToken(token).get('/v1/account');

    expect(response.status).toBe(200);
    expect(response.body.accounts.map((account: { accountName: string }) => account.accountName)).toEqual(
      expect.arrayContaining(['Shared account']),
    );
  });

  it('forbids a read token from writing', async () => {
    const token = await tokenFor(['read']);

    const response = await accountHttp.asToken(token).post('/v1/account/offline').send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'api_token_scope_required' });
  });

  it('lets a write token create and update, and read back what it wrote', async () => {
    const token = await tokenFor(['write']);

    const created = await categoryHttp.asToken(token).post('/v1/category').send({ name: 'Token category' });
    expect(created.status).not.toBe(403);
    expect(created.status).toBeLessThan(400);

    const read = await accountHttp.asToken(token).get('/v1/account');
    expect(read.status).toBe(200);
  });

  it('lets a write-only token read the resources it can change', async () => {
    const token = await tokenFor(['write']);

    const response = await accountHttp.asToken(token).get('/v1/account');

    expect(response.status).toBe(200);
  });

  it('does not let a write-only token read a data mount it cannot change', async () => {
    const token = await tokenFor(['write']);

    const response = await configsHttp.asToken(token).get('/v1/configs');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('api_token_scope_required');
  });

  it('never lets a token reach the forbidden routes', async () => {
    const token = await tokenFor(['read', 'write']);

    for (const [http, path] of [
      [userHttp, '/v1/user/me/profile'],
      [userHttp, '/v1/user/me'],
      [householdHttp, '/v1/household'],
    ] as const) {
      const response = await http.asToken(token).get(path);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('api_token_scope_required');
    }
  });

  it('rejects an expired token with 401', async () => {
    const token = await tokenFor(['read']);
    await em.nativeUpdate(ApiToken, { secretHash: hashApiToken(token) }, {
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await accountHttp.asToken(token).get('/v1/account');
    expect(response.status).toBe(401);
  });

  it('rejects a revoked token with 401 on the next request', async () => {
    const token = await tokenFor(['read']);
    const apiToken = await em.findOne(ApiToken, { secretHash: hashApiToken(token) });
    if (!apiToken) throw new Error('token row missing');
    apiToken.revokedAt = new Date();
    await em.flush();

    const response = await accountHttp.asToken(token).get('/v1/account');
    expect(response.status).toBe(401);
  });

  it('rejects an unknown token with 401', async () => {
    const response = await accountHttp.asToken('wm_pat_unknown').get('/v1/account');
    expect(response.status).toBe(401);
  });

  it('sees the same private accounts as the user: the token does not bypass privacy', async () => {
    await addAccount(em, household, { name: 'Shared account' });
    await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });

    const ownerToken = await tokenFor(['read']);
    const partnerToken = await tokenFor(['read'], partner);

    const ownerView = await accountHttp.asToken(ownerToken).get('/v1/account');
    expect(ownerView.status).toBe(200);
    const ownerNames = ownerView.body.accounts.map((account: { accountName: string }) => account.accountName);
    expect(ownerNames).toContain('Shared account');
    expect(ownerNames).not.toContain('Partner private');

    const partnerView = await accountHttp.asToken(partnerToken).get('/v1/account');
    expect(partnerView.status).toBe(200);
    const partnerNames = partnerView.body.accounts.map((account: { accountName: string }) => account.accountName);
    expect(partnerNames).toEqual(expect.arrayContaining(['Partner private', 'Shared account']));
  });

  it('creates a token once, lists it by prefix and revokes it', async () => {
    const session = userHttp.as(household.appuser);

    const created = await session.post('/v1/user/api-tokens').send({
      expiresInDays: 90,
      name: 'Home dashboard',
      scopes: ['read'],
    });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^wm_pat_[0-9A-Za-z]{43}$/);
    expect(created.body.apiToken).toMatchObject({ name: 'Home dashboard', prefix: expect.stringMatching(/^wm_pat_/) });
    expect(created.body.apiToken.secretHash).toBeUndefined();

    const listed = await session.get('/v1/user/api-tokens');
    expect(listed.status).toBe(200);
    expect(listed.body.apiTokens).toHaveLength(1);
    expect(listed.body.apiTokens[0]).toMatchObject({ prefix: created.body.apiToken.prefix, revokedAt: null });

    const revoked = await session.delete(`/v1/user/api-tokens/${created.body.apiToken.id}`);
    expect(revoked.status).toBe(204);

    const afterRevoke = await accountHttp.asToken(created.body.token).get('/v1/account');
    expect(afterRevoke.status).toBe(401);
  });

  it('does not let a token manage tokens', async () => {
    const token = await tokenFor(['read', 'write']);

    const response = await userHttp.asToken(token).post('/v1/user/api-tokens').send({
      expiresInDays: 30,
      name: 'Nested',
      scopes: ['read'],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('api_token_scope_required');
  });

  it('never writes the plain token to a log line', async () => {
    const token = await tokenFor(['read']);
    const logged: unknown[][] = [];
    const spies = (['debug', 'error', 'info', 'warn'] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
        return logger;
      }),
    );

    try {
      await accountHttp.asToken(token).get('/v1/account');
      // A rejected request logs the reason; it must still not carry the credential.
      await userHttp.asToken(token).get('/v1/user/me/profile');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(JSON.stringify(logged)).not.toContain(token);
  });
});

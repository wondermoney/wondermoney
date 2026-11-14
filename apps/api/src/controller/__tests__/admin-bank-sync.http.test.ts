import { RequestContext } from '@mikro-orm/postgresql';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { TEST_USER_HEADER } from '@app/__tests__/__helpers__/auth-session-double';
import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { DI } from '@app/database/di';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { errorHandler } from '@middleware/error-handler';
import { requireInstanceAdmin } from '@middleware/instance-admin';
import adminBankSyncRoutes from '@route/admin-bank-sync';
import { createApiToken } from '@service/api-token/api-token.service';
import { NotFoundError } from '@utils/errors';

/*
 * Who may read instance-wide sync health: an instance admin's session, or the admin API key.
 * Everyone else gets the same 404 as a path that does not exist, so the endpoints' existence is
 * not revealed; a personal API token never gets through, even an admin's.
 */
const ADMIN_API_KEY = 'test-admin-key';
const ENDPOINTS = ['/v1/admin/bank-sync/health', '/v1/admin/bank-sync/failing'];

function adminApp() {
  const app = express();
  app.use((_req, _res, next) => {
    if (!DI.orm) throw new Error('Test database is not started');
    RequestContext.create(DI.orm.em, next);
  });
  app.use(express.json());
  // The mount in app.ts, minus the rate limiter.
  app.use('/v1/admin/bank-sync', requireInstanceAdmin, adminBankSyncRoutes);
  app.use((_req, _res, next) => {
    next(new NotFoundError());
  });
  app.use(errorHandler);
  return request(app);
}

describe('/v1/admin/bank-sync access', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = adminApp();
  let household: Household;

  beforeEach(async () => {
    vi.stubEnv('ADMIN_API_KEY', ADMIN_API_KEY);
    household = await seedHousehold(db.em());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const makeAccountType = (appuser: Appuser, accountType: AppuserAccountType) =>
    db.em().nativeUpdate(Appuser, { appuserKey: appuser.appuserKey }, { accountType });

  async function notFoundBody() {
    const response = await http.get('/v1/no-such-route');
    expect(response.status).toBe(404);
    return response.body as unknown;
  }

  it('answers a regular user exactly as it answers a path that does not exist', async () => {
    const expected = await notFoundBody();
    for (const path of ENDPOINTS) {
      const response = await http.get(path).set(TEST_USER_HEADER, household.appuser.externalUserId);
      expect(response.status).toBe(404);
      expect(response.body).toEqual(expected);
    }
  });

  it('answers 404 without a session, and to the demo account', async () => {
    await makeAccountType(household.appuser, AppuserAccountType.DEMO);
    for (const path of ENDPOINTS) {
      expect((await http.get(path)).status).toBe(404);
      expect((await http.get(path).set(TEST_USER_HEADER, household.appuser.externalUserId)).status).toBe(404);
    }
  });

  it('refuses a personal API token, even an admin\'s with every scope', async () => {
    await makeAccountType(household.appuser, AppuserAccountType.ADMIN);
    const { token } = await createApiToken(
      { appuser: household.appuser, expiresInDays: 30, name: 'Script', scopes: ['read', 'write', 'mcp:read'], tenant: household.tenant },
      db.em(),
    );
    for (const path of ENDPOINTS) {
      const response = await http.get(path).set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(404);
    }
  });

  it('lets an instance admin\'s session read both endpoints', async () => {
    await makeAccountType(household.appuser, AppuserAccountType.ADMIN);

    const health = await http.get('/v1/admin/bank-sync/health').set(TEST_USER_HEADER, household.appuser.externalUserId);
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ connections: { failing: 0, total: 0 }, failingThresholdHours: 48, institutions: [] });

    const failing = await http.get('/v1/admin/bank-sync/failing').set(TEST_USER_HEADER, household.appuser.externalUserId);
    expect(failing.status).toBe(200);
    expect(failing.body).toMatchObject({ connections: [], thresholdHours: 48 });
  });

  it('stops admin access once the flag is revoked', async () => {
    await makeAccountType(household.appuser, AppuserAccountType.ADMIN);
    expect((await http.get(ENDPOINTS[0] ?? '').set(TEST_USER_HEADER, household.appuser.externalUserId)).status).toBe(200);

    await makeAccountType(household.appuser, AppuserAccountType.REGULAR);
    expect((await http.get(ENDPOINTS[0] ?? '').set(TEST_USER_HEADER, household.appuser.externalUserId)).status).toBe(404);
  });

  it('keeps the admin API key working for scripts, and rejects a wrong one', async () => {
    for (const path of ENDPOINTS) {
      expect((await http.get(path).set('x-api-key', ADMIN_API_KEY)).status).toBe(200);
      expect((await http.get(path).set('x-api-key', 'wrong-key')).status).toBe(401);
    }
  });

  it('answers 404 to an admin for a path under the mount that does not exist', async () => {
    await makeAccountType(household.appuser, AppuserAccountType.ADMIN);
    const response = await http.get('/v1/admin/bank-sync/users').set(TEST_USER_HEADER, household.appuser.externalUserId);
    expect(response.status).toBe(404);
  });
});

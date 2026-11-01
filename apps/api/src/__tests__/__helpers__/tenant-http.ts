/**
 * Drive a real router through the real authenticated-tenant middleware stack, against the
 * real-Postgres harness (`pg-test-db.ts`), as a chosen user.
 *
 * Only the session lookup is replaced: `@service/auth/better-auth` must be mocked by the test
 * file with `mockAuthSession` from `auth-session-double.ts` so the `x-test-user` header names the better-auth user
 * id. Everything after it — `requireAuth`, `getUser`, `resolveTenantForRequest`,
 * `assertTenantResolved`, the per-request `RequestContext` and the global tenant filter — is the
 * production code, so a test here proves what one household member can read or change.
 *
 * Usage:
 *   vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
 *   vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
 *   const db = useTestDatabase(); useRequestContextEm(db);
 *   const http = tenantHttp('/v1/budget', budgetRoutes);
 *   await http.as(appuser).get('/v1/budget/1');
 */
import { RequestContext } from '@mikro-orm/postgresql';
import express, { type Router } from 'express';
import request from 'supertest';
import { beforeEach } from 'vitest';

import type { TestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { errorHandler } from '@middleware/error-handler';
import { authedTenant } from '@middleware/stacks';

import { TEST_USER_HEADER } from './auth-session-double';

export { TEST_USER_HEADER } from '@app/__tests__/__helpers__/auth-session-double';

export function tenantHttp(mountPath: string, router: Router) {
  const app = express();
  app.use((_req, _res, next) => {
    if (!DI.orm) throw new Error('Test database is not started');
    RequestContext.create(DI.orm.em, next);
  });
  app.use(express.json());
  app.use(mountPath, ...authedTenant(), router);
  app.use(errorHandler);
  const agent = request(app);
  return {
    app,
    as(user: Appuser) {
      const id = user.externalUserId;
      return {
        delete: (path: string) => agent.delete(path).set(TEST_USER_HEADER, id),
        get: (path: string) => agent.get(path).set(TEST_USER_HEADER, id),
        patch: (path: string) => agent.patch(path).set(TEST_USER_HEADER, id),
        post: (path: string) => agent.post(path).set(TEST_USER_HEADER, id),
        put: (path: string) => agent.put(path).set(TEST_USER_HEADER, id),
      };
    },
  };
}

/**
 * Point `DI.em` at the root EM so each request gets its own `RequestContext` fork, as in
 * production (identity map and filter params do not leak between requests).
 */
export function useRequestContextEm(db: TestDatabase) {
  beforeEach(() => {
    DI.em = db.orm.em;
  });
}

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AUTHED_MOUNTS, routesOf } from '@app/openapi/route-discovery';
import { HouseholdRole } from '@entity/AppuserTenant';
import { blockViewerWrite, VIEWER_PERSONAL_WRITES, viewerMayRequest } from '@middleware/household';
import { ERROR_CODE } from '@utils/errors';

/**
 * A household viewer reads the shared data and changes none of it. `blockViewerWrite` sits in the
 * `authedTenant` stack, so it sees every authenticated data request; this test walks every router
 * mounted behind it and fails when a write route is neither blocked for a viewer nor listed as one
 * of the viewer's own (`VIEWER_PERSONAL_WRITES`) — so a new write route cannot silently be open to
 * a viewer. The controllers are stubbed: only the route table matters.
 */
const { controllerStub } = vi.hoisted(() => {
  const RESERVED = new Set(['__esModule', 'constructor', 'default', 'then', 'toJSON']);
  return {
    controllerStub: () =>
      new Proxy<Record<string, unknown>>({}, {
        get: (target, property) => {
          if (typeof property !== 'string' || RESERVED.has(property)) return undefined;
          target[property] ??= (_req: unknown, _res: unknown, next: () => void) => { next(); };
          return target[property];
        },
        getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
        has: () => true,
        ownKeys: () => [],
      }),
  };
});

vi.mock('@controller/account', controllerStub);
vi.mock('@controller/api-token', controllerStub);
vi.mock('@controller/assistant', controllerStub);
vi.mock('@controller/assistant-proposal', controllerStub);
vi.mock('@controller/background-operation', controllerStub);
vi.mock('@controller/banking', controllerStub);
vi.mock('@controller/banking-alerts', controllerStub);
vi.mock('@controller/banking-connections', controllerStub);
vi.mock('@controller/budget', controllerStub);
vi.mock('@controller/category', controllerStub);
vi.mock('@controller/configs', controllerStub);
vi.mock('@controller/currency', controllerStub);
vi.mock('@controller/data-export', controllerStub);
vi.mock('@controller/data-restore', controllerStub);
vi.mock('@controller/email-notifications', controllerStub);
vi.mock('@controller/enable-banking-credential', controllerStub);
vi.mock('@controller/feedback', controllerStub);
vi.mock('@controller/goal', controllerStub);
vi.mock('@controller/household', controllerStub);
vi.mock('@controller/insights', controllerStub);
vi.mock('@controller/loan', controllerStub);
vi.mock('@controller/manual-asset', controllerStub);
vi.mock('@controller/net-worth', controllerStub);
vi.mock('@controller/onboarding', controllerStub);
vi.mock('@controller/portfolio', controllerStub);
vi.mock('@controller/portfolio-import-session', controllerStub);
vi.mock('@controller/recurring', controllerStub);
vi.mock('@controller/reports', controllerStub);
vi.mock('@controller/rule', controllerStub);
vi.mock('@controller/tag', controllerStub);
vi.mock('@controller/transaction-import', controllerStub);
vi.mock('@controller/transaction-split', controllerStub);
vi.mock('@controller/transaction-template', controllerStub);
vi.mock('@controller/user', controllerStub);
vi.mock('@controller/user-preferences', controllerStub);
vi.mock('@controller/watchlist', controllerStub);

const passthrough = (_req: unknown, _res: unknown, next: () => void) => { next(); };
vi.mock('@middleware/ai-allowance', () => ({ requireAiAllowance: () => passthrough }));
vi.mock('@middleware/demo', () => ({ blockDemoStateChange: passthrough }));
vi.mock('@middleware/email-verification', () => ({ requireVerifiedEmailForAi: passthrough }));
vi.mock('@middleware/multer', () => ({ default: passthrough }));
vi.mock('@middleware/sensitive-session', () => ({ requireSensitiveSession: passthrough }));

interface Route {
  method: string;
  mount: string;
  path: string;
}

async function allRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  for (const [mount, load] of Object.entries(AUTHED_MOUNTS)) routes.push(...routesOf(await load(), mount));
  return routes;
}

const isWrite = (route: Route) => !['GET', 'HEAD', 'OPTIONS'].includes(route.method);
const routeKey = (route: Route) => `${route.mount} ${route.method} ${route.path}`;
const personalKeys = new Set(VIEWER_PERSONAL_WRITES.map(routeKey));
/** A concrete request path for a route pattern. */
const concrete = (path: string) => path.replaceAll(/:[A-Za-z]+/gu, '7');

describe('a household viewer reads only', () => {
  it('blocks every mounted write route except the viewer’s own', async () => {
    const writes = (await allRoutes()).filter(isWrite);
    expect(writes.length).toBeGreaterThan(100);

    const violations = writes
      .filter((route) => viewerMayRequest(route.mount, route.method, concrete(route.path)) !== personalKeys.has(routeKey(route)))
      .map(routeKey);
    expect(violations).toEqual([]);
  });

  it('has no dead entry: every personal write is a real mounted route', async () => {
    const real = new Set((await allRoutes()).map(routeKey));
    expect([...personalKeys].filter((key) => !real.has(key))).toEqual([]);
  });

  it('lets a viewer read every mounted route', async () => {
    const refused = (await allRoutes())
      .filter((route) => !isWrite(route) && !viewerMayRequest(route.mount, route.method, concrete(route.path)))
      .map(routeKey);
    expect(refused).toEqual([]);
  });

  /** The guard as mounted: in front of a router, where Express gives it the mount and the rest of the path. */
  function appWith(role: HouseholdRole | undefined) {
    const app = express();
    app.use((req, _res, next) => {
      req.householdRole = role;
      next();
    });
    for (const mount of ['/v1/category', '/v1/user']) {
      const router = express.Router();
      router.all('/{*rest}', (_req, res) => { res.sendStatus(204); });
      app.use(mount, blockViewerWrite, router);
    }
    app.use((error: { code?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.status ?? 500).json({ code: error.code });
    });
    return request(app);
  }

  it('answers a viewer’s write on shared data with 403 household_read_only', async () => {
    const response = await appWith(HouseholdRole.VIEWER).post('/v1/category/');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(ERROR_CODE.HOUSEHOLD_READ_ONLY);
  });

  it('lets a viewer read, and change their own settings', async () => {
    expect((await appWith(HouseholdRole.VIEWER).get('/v1/category/')).status).toBe(204);
    expect((await appWith(HouseholdRole.VIEWER).patch('/v1/user/me/preferences')).status).toBe(204);
  });

  it.each([HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER])('lets the %s write', async (role) => {
    expect((await appWith(role).post('/v1/category/')).status).toBe(204);
  });

  it('blocks writes when no household role was resolved', async () => {
    expect((await appWith(undefined).post('/v1/category/')).status).toBe(403);
  });
});

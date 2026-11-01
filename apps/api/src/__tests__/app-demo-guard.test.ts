import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_CODE } from '@utils/errors';

/**
 * The demo account is read-only on every authenticated data mount, and the tenant scope is
 * asserted on each of them before any route runs. Mounts the real application with the real
 * `blockDemoMutation` and `assertTenantResolved`; only identity resolution and the route
 * handlers are stubbed, so a mount that loses its stack fails here.
 *
 * Test identity is chosen per request:
 *   - no `authorization` header → unauthenticated;
 *   - `x-test-user: demo` → the demo user in the demo tenant, otherwise a regular user;
 *   - `x-test-no-tenant` → the user resolves but no tenant does.
 */

const reached = vi.hoisted(() => vi.fn());

const makeRouter = () => {
  const router = express.Router();
  router.all('/{*path}', (req, res) => {
    reached(req.method, req.originalUrl);
    res.status(200).json({ ok: true });
  });
  return router;
};

const handler = (_req: express.Request, res: express.Response) => {
  reached(_req.method, _req.originalUrl);
  res.status(200).json({ ok: true });
};

vi.mock('@app/database/di', () => ({
  connectDatabase: vi.fn().mockResolvedValue({
    em: {
      fork: vi.fn(() => ({ getConnection: () => ({ isConnected: vi.fn().mockResolvedValue(true) }) })),
      getConnection: () => ({ isConnected: vi.fn().mockResolvedValue(true) }),
    },
  }),
  DI: {
    em: {
      fork: vi.fn(() => ({ getConnection: () => ({ isConnected: vi.fn().mockResolvedValue(true) }) })),
      getConnection: () => ({ isConnected: vi.fn().mockResolvedValue(true) }),
    },
  },
}));

vi.mock('@middleware/auth', () => {
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization) {
      next();
      return;
    }
    res.sendStatus(401);
  };
  const passThrough = (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); };
  return { adminAuth: passThrough, optionalAuth: passThrough, requireAuth, requireBearerAuth: requireAuth };
});

vi.mock('@middleware/user', () => {
  const setUser = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization) {
      const demo = req.headers['x-test-user'] === 'demo';
      req.user = { accountType: demo ? 'demo' : 'regular', appuserKey: demo ? 1 : 2 } as unknown as express.Request['user'];
    }
    next();
  };
  return { getUser: setUser, getUserOptional: setUser };
});

vi.mock('@middleware/tenant', () => ({
  resolveTenantForRequest: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (!req.headers['x-test-no-tenant']) {
      const demo = req.headers['x-test-user'] === 'demo';
      req.tenant = { tenantKey: demo ? 1 : 2, tenantType: demo ? 'demo' : 'regular' } as unknown as express.Request['tenant'];
    }
    next();
  },
}));

vi.mock('@controller/auth', () => ({ authCallback: handler }));
vi.mock('@controller/banking', () => ({
  getBankList: handler,
  getBankSyncStatus: handler,
  startBankConnection: handler,
  unlinkRequisition: handler,
}));
vi.mock('@controller/banking-connections', () => ({ getBankConnections: handler }));

vi.mock('@route/account', () => ({ default: makeRouter() }));
vi.mock('@route/admin', () => ({ default: makeRouter() }));
vi.mock('@route/assistant', () => ({ default: makeRouter() }));
vi.mock('@route/background-operation', () => ({ default: makeRouter() }));
vi.mock('@route/budget', () => ({ default: makeRouter() }));
vi.mock('@route/category', () => ({ default: makeRouter() }));
vi.mock('@route/configs', () => ({ default: makeRouter() }));
vi.mock('@route/feedback', () => ({ default: makeRouter() }));
vi.mock('@route/financial-markets', () => ({ default: makeRouter() }));
vi.mock('@route/goal', () => ({ default: makeRouter() }));
vi.mock('@route/household', () => ({ default: makeRouter() }));
vi.mock('@route/instance', () => ({ default: makeRouter() }));
vi.mock('@route/loan', () => ({ default: makeRouter() }));
vi.mock('@route/marketing', () => ({ default: makeRouter() }));
vi.mock('@route/net-worth', () => ({ default: makeRouter() }));
vi.mock('@route/portfolio', () => ({ default: makeRouter() }));
vi.mock('@route/portfolio-import-session', () => ({ default: makeRouter() }));
vi.mock('@route/recurring', () => ({ default: makeRouter() }));
vi.mock('@route/reports', () => ({ default: makeRouter() }));
vi.mock('@route/support', () => ({ default: makeRouter() }));
vi.mock('@route/user', () => ({ default: makeRouter() }));

vi.mock('swagger-ui-express', () => ({
  default: {
    serve: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
    setup: () => (_req: express.Request, res: express.Response) => res.status(200).json({ swagger: true }),
  },
}));

vi.mock('@service/sentry', () => ({}));

/** Every authenticated mount that holds household data. */
const GUARDED_MOUNTS = [
  '/v1/account',
  '/v1/assistant',
  '/v1/banking',
  '/v1/budget',
  '/v1/category',
  '/v1/configs',
  '/v1/feedback',
  '/v1/financial-markets',
  '/v1/goals',
  '/v1/household',
  '/v1/loan',
  '/v1/net-worth',
  '/v1/portfolio',
  '/v1/portfolio-import-sessions',
  '/v1/recurring',
  '/v1/reports',
  '/v1/user',
];

async function loadApp() {
  vi.resetModules();
  Object.assign(process.env, { ADMIN_API_KEY: 'admin-key', NODE_ENV: 'development', PORT: '3001' });
  const { default: Application } = await import('../app');
  const app = new Application();
  await app.connect();
  await app.init(false);
  return app.host;
}

describe('demo guard and tenant scope on authenticated mounts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(GUARDED_MOUNTS)('%s rejects a demo write before it reaches the route', async (mount) => {
    const host = await loadApp();

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(host)[method](`${mount}/anything`).set('authorization', 'Bearer t').set('x-test-user', 'demo');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: ERROR_CODE.DEMO_READ_ONLY });
    }
    expect(reached).not.toHaveBeenCalled();
  });

  it.each(GUARDED_MOUNTS)('%s lets the demo account read and a regular user write', async (mount) => {
    const host = await loadApp();
    // `/bank/:id/start` is a demo-blocked GET; any other path is a plain read.
    const readPath = `${mount}/connections`;

    const demoRead = await request(host).get(readPath).set('authorization', 'Bearer t').set('x-test-user', 'demo');
    const regularWrite = await request(host).post(`${mount}/anything`).set('authorization', 'Bearer t');

    expect(demoRead.status).toBe(200);
    expect(regularWrite.status).not.toBe(403);
  });

  it.each(GUARDED_MOUNTS)('%s requires a session and a resolved tenant', async (mount) => {
    const host = await loadApp();

    const anonymous = await request(host).get(`${mount}/connections`);
    const noTenant = await request(host).get(`${mount}/connections`).set('authorization', 'Bearer t').set('x-test-no-tenant', '1');

    expect(anonymous.status).toBe(401);
    expect(noTenant.status).toBe(500);
    expect(reached).not.toHaveBeenCalled();
  });

  it('blocks the demo account from starting a bank connection, which is a GET', async () => {
    const host = await loadApp();

    const demo = await request(host).get('/v1/banking/bank/SOME_BANK/start').set('authorization', 'Bearer t').set('x-test-user', 'demo');
    expect(demo.status).toBe(403);
    expect(reached).not.toHaveBeenCalled();

    const regular = await request(host).get('/v1/banking/bank/SOME_BANK/start').set('authorization', 'Bearer t');
    expect(regular.status).toBe(200);
  });

  it('lets the demo account complete the auth callback', async () => {
    const host = await loadApp();

    const res = await request(host).post('/v1/auth/callback').set('authorization', 'Bearer t').set('x-test-user', 'demo');

    expect(res.status).toBe(200);
    expect(reached).toHaveBeenCalledWith('POST', '/v1/auth/callback');
  });
});

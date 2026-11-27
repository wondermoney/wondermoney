import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * OpenAI's domain-verification file, requested through the real application: the mount in
 * `app.ts` must answer `/.well-known/openai-apps-challenge` at the API's root, without a
 * credential and ahead of the catch-all 404. The handler's own behaviour (plain text, 404 when
 * unset) is in `routes/v1/__tests__/openai-apps-challenge.test.ts`; this pins where it is mounted.
 * The data routes are stood in for, as in `app-validation-errors.test.ts`.
 */

const makeRouter = () => {
  const router = express.Router();
  router.get('/', (_req, res) => res.status(200).json({ ok: true }));
  return router;
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

vi.mock('@middleware/auth', () => ({
  adminAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-api-key'] === 'admin-key') {
      next();
      return;
    }
    res.sendStatus(401);
  },
  optionalAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization) {
      next();
      return;
    }
    res.sendStatus(401);
  },
}));

vi.mock('@middleware/user', () => ({
  getUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
  getUserOptional: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
}));

// Pass-through tenant middleware, so mounting the data routes needs no database.
const tenantMiddleware = vi.hoisted(() => ({
  assertTenantResolved: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); }),
  resolveTenantForRequest: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); }),
}));

vi.mock('@middleware/tenant', () => ({
  resolveTenantForRequest: tenantMiddleware.resolveTenantForRequest,
}));
vi.mock('@middleware/tenant-scope', () => ({ assertTenantResolved: tenantMiddleware.assertTenantResolved }));

vi.mock('@route/account', () => ({ default: makeRouter() }));
vi.mock('@route/admin', () => ({ default: makeRouter() }));
vi.mock('@route/assistant', () => ({ default: makeRouter() }));
vi.mock('@route/auth', () => ({ default: makeRouter() }));
vi.mock('@route/background-operation', () => ({ default: makeRouter() }));
vi.mock('@route/banking', () => ({ default: makeRouter() }));
vi.mock('@route/budget', () => ({ default: makeRouter() }));
vi.mock('@route/category', () => ({ default: makeRouter() }));
vi.mock('@route/configs', () => ({ default: makeRouter() }));
vi.mock('@route/loan', () => ({ default: makeRouter() }));
vi.mock('@route/financial-markets', () => ({ default: makeRouter() }));
vi.mock('@route/goal', () => ({ default: makeRouter() }));
vi.mock('@route/marketing', () => ({ default: makeRouter() }));
vi.mock('@route/net-worth', () => ({ default: makeRouter() }));
vi.mock('@route/portfolio', () => ({ default: makeRouter() }));
vi.mock('@route/portfolio-import-session', () => ({ default: makeRouter() }));
vi.mock('@route/recurring', () => ({ default: makeRouter() }));
vi.mock('@route/support', () => ({ default: makeRouter() }));
vi.mock('@route/user', () => ({ default: makeRouter() }));
vi.mock('@route/webhooks', () => ({ default: express.Router() }));

vi.mock('swagger-ui-express', () => ({
  default: {
    serve: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
    setup: () => (_req: express.Request, res: express.Response) => res.status(200).json({ swagger: true }),
  },
}));

vi.mock('@service/sentry', () => ({}));

async function loadApp() {
  vi.resetModules();
  Object.assign(process.env, { ADMIN_API_KEY: 'admin-key', NODE_ENV: 'production', PORT: '3001' });
  const { default: Application } = await import('../app');
  const app = new Application();
  await app.connect();
  await app.init(false);
  return app;
}

describe('the application', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves OpenAI\'s domain-verification token at /.well-known/openai-apps-challenge, without a credential', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', 'oa-challenge-mounted');
    const app = await loadApp();

    const response = await request(app.host).get('/.well-known/openai-apps-challenge');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain\b/);
    expect(response.text).toBe('oa-challenge-mounted');
  });
});

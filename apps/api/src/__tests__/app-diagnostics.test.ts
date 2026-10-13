import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const makeRouter = () => {
  const router = express.Router();
  router.get('/', (_req, res) => res.status(200).json({ ok: true }));
  return router;
};

const enableBankingCallback = vi.fn((_req: express.Request, res: express.Response) => res.status(200).json({ callback: true }));

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

// Pass-through spies so a mount's middleware chain can be asserted without a database. Nothing
// else in this file reaches these — every other request is stopped by `requireAuth` first.
const tenantMiddleware = vi.hoisted(() => ({
  assertTenantResolved: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); }),
  resolveTenantForRequest: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); }),
}));

vi.mock('@middleware/tenant', () => ({
  resolveTenantForRequest: tenantMiddleware.resolveTenantForRequest,
}));
vi.mock('@middleware/tenant-scope', () => ({ assertTenantResolved: tenantMiddleware.assertTenantResolved }));

vi.mock('@route/account', () => ({ default: makeRouter() }));
vi.mock('@controller/enable-banking-callback', () => ({ enableBankingCallback }));
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


async function loadApp(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, {
    ...env,
    ADMIN_API_KEY: 'admin-key',
    PORT: '3001',
  });
  const { default: Application } = await import('../app');
  const app = new Application();
  await app.connect();
  await app.init(false);
  return app;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

describe('Application diagnostics exposure', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'development';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exposes detailed health and public docs in development', async () => {
    const app = await loadApp({ NODE_ENV: 'development' });

    const health = await request(app.host).get('/v1/health');
    expect(health.status).toBe(200);
    expect(health.body).toHaveProperty('db.connected', true);
    expect(health.body).toHaveProperty('gitCommitHash');

    const docs = await request(app.host).get('/docs');
    expect(docs.status).toBe(200);
    expect(docs.body).toEqual({ swagger: true });
  });

  it('keeps production health minimal and protects docs', async () => {
    const app = await loadApp({ NODE_ENV: 'production' });

    const health = await request(app.host).get('/v1/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });

    const forbiddenDocs = await request(app.host).get('/docs');
    expect(forbiddenDocs.status).toBe(401);

    const authorizedDocs = await request(app.host).get('/docs').set('x-api-key', 'admin-key');
    expect(authorizedDocs.status).toBe(200);
    expect(authorizedDocs.body).toEqual({ swagger: true });
  });

  it('allows detailed production diagnostics when enabled', async () => {
    const app = await loadApp({ NODE_ENV: 'production', PUBLIC_DIAGNOSTICS_ENABLED: 'true' });

    const health = await request(app.host).get('/v1/health');
    expect(health.status).toBe(200);
    expect(health.body).toHaveProperty('db.connected', true);
    expect(health.body).toHaveProperty('status', 'ok');
  });

  /**
   * `/v1/operations` was the only authenticated data mount that armed neither tenant middleware,
   * so the ORM tenant filter stayed in system-bypass mode for the whole request and the team's
   * fail-loud invariant did not hold there.
   */
  it('arms the tenant filter on the operations mount like every other authed data mount', async () => {
    const app = await loadApp({ NODE_ENV: 'development' });

    const response = await request(app.host).get('/v1/operations').set('authorization', 'Bearer token');

    expect(response.status).toBe(200);
    expect(tenantMiddleware.resolveTenantForRequest).toHaveBeenCalled();
    expect(tenantMiddleware.assertTenantResolved).toHaveBeenCalled();
  });

  it('keeps the banking callback public while protecting other banking routes', async () => {
    const app = await loadApp({ NODE_ENV: 'production' });

    const callback = await request(app.host).get('/v1/banking/enable-banking/callback?state=state-1');
    expect(callback.status).toBe(200);
    expect(enableBankingCallback).toHaveBeenCalled();

    const protectedRoute = await request(app.host).get('/v1/banking/bank');
    expect(protectedRoute.status).toBe(401);
  });

  /**
   * The docs gate reads the resolved app environment (the same source the error handler uses),
   * not a bare `NODE_ENV === 'production'` match — staging shares production origins in the
   * CORS/CSRF allow-lists, so reconnaissance there transfers directly to production.
   */
  describe('staging inherits the production docs posture', () => {
    const previousAppEnv = process.env['APP_ENV'];
    const previousPublicDiagnostics = process.env['PUBLIC_DIAGNOSTICS_ENABLED'];

    afterEach(() => {
      // Restored (rather than left set) because `loadApp` mutates the shared `process.env`, and an
      // empty-string `APP_ENV` is not a valid environment — `@config/env` throws on it.
      restoreEnv('APP_ENV', previousAppEnv);
      restoreEnv('PUBLIC_DIAGNOSTICS_ENABLED', previousPublicDiagnostics);
    });

    it('admin-gates /docs on staging', async () => {
      // Cleared explicitly: an earlier test in this file opts diagnostics in and `loadApp`
      // mutates the shared `process.env` without restoring it.
      restoreEnv('PUBLIC_DIAGNOSTICS_ENABLED', undefined);
      const app = await loadApp({ APP_ENV: 'staging', NODE_ENV: 'development' });

      const forbiddenDocs = await request(app.host).get('/docs');
      expect(forbiddenDocs.status).toBe(401);

      const authorizedDocs = await request(app.host).get('/docs').set('x-api-key', 'admin-key');
      expect(authorizedDocs.status).toBe(200);
    });

    it('still allows an explicit diagnostics opt-in on staging', async () => {
      const app = await loadApp({ APP_ENV: 'staging', NODE_ENV: 'development', PUBLIC_DIAGNOSTICS_ENABLED: 'true' });

      const docs = await request(app.host).get('/docs');
      expect(docs.status).toBe(200);
    });
  });
});

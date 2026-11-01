import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

/**
 * The body a client receives when a request fails validation.
 *
 * Web and mobile branch on `code` and render `message`; neither parses the message. So the
 * contract is: a 400 with exactly `{ code: 'bad_request', message }`, where the message is a
 * non-empty string naming the offending field. A Zod or zod-validation-error upgrade that
 * changed the body's shape, status or code — or dropped the field path from the message —
 * would break clients, and fails here. The wording itself is deliberately not pinned.
 */

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
vi.mock('@route/support', async () => ({ default: (await import('./__helpers__/validation-router')).validationRouter() }));
vi.mock('@route/user', () => ({ default: makeRouter() }));
vi.mock('@route/webhooks', () => ({ default: express.Router() }));

vi.mock('swagger-ui-express', () => ({
  default: {
    serve: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
    setup: () => (_req: express.Request, res: express.Response) => res.status(200).json({ swagger: true }),
  },
}));

vi.mock('@service/sentry', () => ({}));



async function loadApp(nodeEnv: string) {
  vi.resetModules();
  Object.assign(process.env, { ADMIN_API_KEY: 'admin-key', NODE_ENV: nodeEnv, PORT: '3001' });
  const { default: Application } = await import('../app');
  const app = new Application();
  await app.connect();
  await app.init(false);
  return app;
}

describe.each(['development', 'production'])('validation error responses (%s)', (nodeEnv) => {
  it('answers an invalid body with a 400 carrying a stable code and a message naming the field', async () => {
    const app = await loadApp(nodeEnv);

    const response = await request(app.host).post('/v1/support/validated').send({ amount: 'ten', note: 'ok' });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body as object).sort()).toEqual(['code', 'message']);
    expect(response.body).toEqual({ code: 'bad_request', message: expect.stringContaining('body.amount') });
  });

  it('reports every failing field in the one message', async () => {
    const app = await loadApp(nodeEnv);

    const response = await request(app.host).post('/v1/support/validated').send({ amount: -1 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'bad_request', message: expect.stringContaining('body.amount') });
    expect((response.body as { message: string }).message).toContain('body.note');
  });

  it('rejects an unknown key on a strict body', async () => {
    const app = await loadApp(nodeEnv);

    const response = await request(app.host).post('/v1/support/validated').send({ amount: 1, extra: true, note: 'ok' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'bad_request', message: expect.stringContaining('extra') });
  });

  it('passes a valid body through to the handler with parsed values', async () => {
    const app = await loadApp(nodeEnv);

    const response = await request(app.host).post('/v1/support/validated').send({ amount: 10, note: 'ok' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ amount: 10, note: 'ok' });
  });
});

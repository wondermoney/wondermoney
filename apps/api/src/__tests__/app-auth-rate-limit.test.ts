import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const makeRouter = () => {
  const router = express.Router();
  router.all('/', (_req, res) => res.status(200).json({ ok: true }));
  return router;
};

// better-auth's embedded handler catches every /api/auth/* request. The global test
// double (src/test/setup.ts) already stubs it with a plain 200, so we can distinguish a
// request that reached the handler (200) from one the auth limiter rejected (429).

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

vi.mock('@route/account', () => ({ default: makeRouter() }));
vi.mock('@controller/banking', () => ({ bankConnectionCallback: vi.fn((_req: express.Request, res: express.Response) => res.status(200).json({ callback: true })) }));
vi.mock('@route/admin', () => ({ default: makeRouter() }));
vi.mock('@route/assistant', () => ({ default: makeRouter() }));
vi.mock('@route/auth', () => ({ default: makeRouter() }));
vi.mock('@route/background-operation', () => ({ default: makeRouter() }));
vi.mock('@route/banking', () => ({ default: makeRouter() }));
vi.mock('@route/budget', () => ({ default: makeRouter() }));
vi.mock('@route/category', () => ({ default: makeRouter() }));
vi.mock('@route/configs', () => ({ default: makeRouter() }));
vi.mock('@route/credit', () => ({ default: makeRouter() }));
vi.mock('@route/financial-markets', () => ({ default: makeRouter() }));
vi.mock('@route/goal', () => ({ default: makeRouter() }));
vi.mock('@route/instance', () => ({ default: makeRouter() }));
vi.mock('@route/marketing', () => ({ default: makeRouter() }));
vi.mock('@route/net-worth', () => ({ default: makeRouter() }));
vi.mock('@route/portfolio', () => ({ default: makeRouter() }));
vi.mock('@route/portfolio-import-session', () => ({ default: makeRouter() }));
vi.mock('@route/recurring', () => ({ default: makeRouter() }));
vi.mock('@route/support', () => ({ default: makeRouter() }));
vi.mock('@route/user', () => ({ default: makeRouter() }));

vi.mock('swagger-ui-express', () => ({
  default: {
    serve: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { next(); },
    setup: () => (_req: express.Request, res: express.Response) => res.status(200).json({ swagger: true }),
  },
}));

vi.mock('@service/sentry', () => ({}));

// Keep this in sync with the authExchange family limit in src/middleware/rate-limit.ts
// (and the mount in src/app.ts). The authExchange family covers all credential-bearing
// exchanges, not just sign-in, so the budget is broader than the old per-endpoint 10.
const AUTH_LIMIT = 30;

async function loadApp() {
  vi.resetModules();
  Object.assign(process.env, {
    ADMIN_API_KEY: 'admin-key',
    NODE_ENV: 'development',
    PORT: '3001',
  });
  const { default: Application } = await import('../app');
  const app = new Application();
  await app.connect();
  await app.init(false);
  return app;
}

describe('Auth endpoint rate limiting', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'development';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lets sign-in requests through while under the auth budget', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      const res = await request(app.host).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' });
      expect(res.status).not.toBe(429);
    }
  });

  it('returns 429 once sign-in exceeds the auth budget', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      await request(app.host).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' });
    }

    const overLimit = await request(app.host).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' });
    expect(overLimit.status).toBe(429);
  });

  it('rate-limits password-reset requests on the same budget', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      await request(app.host).post('/api/auth/forget-password').send({ email: 'a@b.com' });
    }

    const overLimit = await request(app.host).post('/api/auth/forget-password').send({ email: 'a@b.com' });
    expect(overLimit.status).toBe(429);
  });

  it('rate-limits passkey sign-in on the auth budget', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      const res = await request(app.host).post('/api/auth/passkey/verify-authentication').send({ response: {} });
      expect(res.status).not.toBe(429);
    }

    const overLimit = await request(app.host).get('/api/auth/passkey/generate-authenticate-options');
    expect(overLimit.status).toBe(429);
  });

  it('rate-limits adding, renaming and deleting passkeys on the auth budget', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      await request(app.host).post('/api/auth/passkey/delete-passkey').send({ id: 'passkey' });
    }

    for (const path of ['/api/auth/passkey/generate-register-options', '/api/auth/passkey/verify-registration', '/api/auth/passkey/update-passkey']) {
      const res = path.includes('generate') ? await request(app.host).get(path) : await request(app.host).post(path).send({});
      expect(res.status).toBe(429);
    }
  });

  it('keeps passkey traffic out of the password sign-in budget, and the passkey list off both', async () => {
    const app = await loadApp();

    // The login page asks for passkey options on every visit (autofill); that must not use
    // up the attempts a password sign-in gets.
    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      await request(app.host).get('/api/auth/passkey/generate-authenticate-options');
    }
    const passwordSignIn = await request(app.host).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' });
    expect(passwordSignIn.status).not.toBe(429);

    for (let i = 0; i < AUTH_LIMIT + 5; i += 1) {
      const res = await request(app.host).get('/api/auth/passkey/list-user-passkeys');
      expect(res.status).not.toBe(429);
    }
  });

  it('rate-limits the OIDC callback on the auth budget, apart from password sign-in', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      const res = await request(app.host).get('/api/auth/callback/oidc?code=code&state=state');
      expect(res.status).not.toBe(429);
    }

    expect((await request(app.host).get('/api/auth/callback/oidc?code=code&state=state')).status).toBe(429);
    // The provider may post the code back (response_mode=form_post).
    expect((await request(app.host).post('/api/auth/callback/oidc').send({ code: 'code', state: 'state' })).status).toBe(429);
    expect((await request(app.host).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' })).status).not.toBe(429);
  });

  it('gives the demo sign-in its own auth budget, apart from password sign-in', async () => {
    const app = await loadApp();

    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      const res = await request(app.host).post('/v1/auth/demo');
      expect(res.status).not.toBe(429);
    }

    const overLimit = await request(app.host).post('/v1/auth/demo');
    expect(overLimit.status).toBe(429);
    expect(Number(overLimit.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(app.host).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' })).status).not.toBe(429);
  });

  it('does not apply the strict auth limit to non-sensitive auth paths', async () => {
    const app = await loadApp();

    // Well beyond AUTH_LIMIT: get-session is not a credential-guessing surface,
    // so it must not be throttled by the stricter auth limiter.
    for (let i = 0; i < AUTH_LIMIT + 5; i += 1) {
      const res = await request(app.host).get('/api/auth/get-session');
      expect(res.status).not.toBe(429);
    }
  });
});

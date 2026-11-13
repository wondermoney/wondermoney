import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const makeRouter = () => {
  const router = express.Router();
  router.all('/', (_req, res) => res.status(200).json({ ok: true }));
  return router;
};

/*
 * The shared demo account cannot change itself through better-auth's own routes. Mounts the real
 * application; better-auth is the global double, whose handler answers 200 to anything that
 * reaches it, and whose session lookup each test points at the demo account or a regular one.
 */

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

import { getAuthSession } from '@service/auth/better-auth';
import { ERROR_CODE } from '@utils/errors';

const sessionOf = (email: string) => ({
  session: { createdAt: new Date(), id: 'session-id' },
  user: { email, emailVerified: true, id: 'user-id', twoFactorEnabled: false },
});

let host: Promise<express.Express> | undefined;

function loadApp() {
  host ??= (async () => {
    Object.assign(process.env, { ADMIN_API_KEY: 'admin-key', NODE_ENV: 'development', PORT: '3001' });
    const { default: Application } = await import('../app');
    const app = new Application();
    await app.connect();
    await app.init(false);
    return app.host;
  })();
  return host;
}

const ACCOUNT_CHANGES = [
  '/api/auth/update-user',
  '/api/auth/change-email',
  '/api/auth/change-password',
  '/api/auth/delete-user',
  '/api/auth/two-factor/enable',
  '/api/auth/passkey/verify-registration',
  '/api/auth/revoke-sessions',
  '/api/auth/link-social',
];

describe('the demo account on better-auth routes', () => {
  afterEach(() => {
    vi.mocked(getAuthSession).mockReset();
  });

  it.each(ACCOUNT_CHANGES)('refuses %s for the demo session', async (path) => {
    vi.mocked(getAuthSession).mockResolvedValue(sessionOf('demo@wonder.money'));

    const res = await request(await loadApp()).post(path).send({});

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: ERROR_CODE.DEMO_READ_ONLY });
  });

  it.each(ACCOUNT_CHANGES)('lets a regular account reach %s', async (path) => {
    vi.mocked(getAuthSession).mockResolvedValue(sessionOf('owner@example.test'));

    const res = await request(await loadApp()).post(path).send({});

    expect(res.status).toBe(200);
  });

  it('hides the session list, which would show other visitors', async () => {
    vi.mocked(getAuthSession).mockResolvedValue(sessionOf('demo@wonder.money'));

    const res = await request(await loadApp()).get('/api/auth/list-sessions');

    expect(res.status).toBe(403);
  });

  it('still lets the demo session read itself, sign out and sign in elsewhere', async () => {
    vi.mocked(getAuthSession).mockResolvedValue(sessionOf('demo@wonder.money'));
    const app = await loadApp();

    expect((await request(app).get('/api/auth/get-session')).status).toBe(200);
    expect((await request(app).post('/api/auth/sign-out').send({})).status).toBe(200);
    expect((await request(app).post('/api/auth/sign-in/email').send({ email: 'a@b.com', password: 'x' })).status).toBe(200);
  });
});

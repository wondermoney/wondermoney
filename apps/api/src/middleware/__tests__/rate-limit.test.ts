import type { Server } from 'node:http';

import express, { type Request, type RequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));

vi.mock('@sentry/node', () => ({
  addBreadcrumb: sentry.addBreadcrumb,
  captureMessage: sentry.captureMessage,
}));

type RateLimitModule = typeof import('../rate-limit');

/**
 * The relaxed multiplier and every family ceiling are resolved once, at module load, from
 * `process.env`. Re-import the module under a stubbed environment so each case sees the
 * ceilings that environment would really produce in a running process.
 */
async function loadRateLimitModule(env: Record<string, string>): Promise<RateLimitModule> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('../rate-limit');
}

const PRODUCTION_ENV = { APP_ENV: 'production', DEPLOY_ENV: 'production', NODE_ENV: 'production' };
const STAGING_ENV = { APP_ENV: 'staging', DEPLOY_ENV: 'staging', NODE_ENV: 'staging' };

const openServers: Server[] = [];

/**
 * Mount `limiter` on a throwaway app and start listening. These cases fire hundreds of
 * requests, so each app gets one long-lived server rather than one per request.
 */
function buildApp(limiter: RequestHandler, authenticateAs?: string): Server {
  const app = express();
  // Mirrors app.ts, and lets the tests drive `req.ip` through X-Forwarded-For.
  app.set('trust proxy', true);
  if (authenticateAs !== undefined) {
    // Stands in for `requireAuth`: only a verified better-auth session ever populates this.
    app.use((req, _res, next) => {
      req.authUser = { session: { id: authenticateAs }, user: { email: `${authenticateAs}@example.com`, emailVerified: true, id: authenticateAs } };
      next();
    });
  }
  app.use(limiter);
  app.all('/thing', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  const server = app.listen(0);
  openServers.push(server);
  return server;
}

async function drain(server: Server, count: number, method: 'get' | 'post' = 'get', ip?: string) {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const pending = request(server)[method]('/thing');
    if (ip) pending.set('X-Forwarded-For', ip);
    // Sequential on purpose: the assertions are about the Nth request, not throughput.
    const response = await pending;
    statuses.push(response.status);
  }
  return statuses;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise((done) => server.close(done))));
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('rate-limit families (RAD-547)', () => {
  describe('strict families keep a low ceiling', () => {
    it('blocks the admin API after 5 requests in production', async () => {
      const { adminApiRateLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      const app = buildApp(adminApiRateLimit());

      const statuses = await drain(app, 6, 'get', '9.9.9.9');

      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses[5]).toBe(429);
    });

    it('is never loosened by the non-production multiplier', async () => {
      const { RATE_LIMIT_FAMILIES, RELAXED_MULTIPLIER, resolveFamilyLimit } = await loadRateLimitModule(STAGING_ENV);

      // The escape hatch is live for ordinary reads...
      expect(RELAXED_MULTIPLIER).toBeGreaterThan(1);
      expect(resolveFamilyLimit('read')).toBe(RATE_LIMIT_FAMILIES.read.limit * RELAXED_MULTIPLIER);

      // ...but every brute-forceable surface keeps its production ceiling.
      expect(resolveFamilyLimit('adminApi')).toBe(5);
      expect(resolveFamilyLimit('authExchange')).toBe(30);
      expect(resolveFamilyLimit('inviteLookup')).toBe(20);
      expect(resolveFamilyLimit('publicMarketing')).toBe(50);
      expect(resolveFamilyLimit('support')).toBe(5);
    });

    it('still blocks the admin API at 5 on staging, where reads are relaxed', async () => {
      const { adminApiRateLimit } = await loadRateLimitModule(STAGING_ENV);
      const app = buildApp(adminApiRateLimit());

      const statuses = await drain(app, 6, 'get', '9.9.9.8');

      expect(statuses[4]).toBe(200);
      expect(statuses[5]).toBe(429);
    });

    it('marks every credential-adjacent family as IP-scoped and non-relaxable', async () => {
      const { RATE_LIMIT_FAMILIES } = await loadRateLimitModule(PRODUCTION_ENV);

      for (const name of ['adminApi', 'authExchange', 'inviteLookup', 'publicMarketing', 'support'] as const) {
        expect(RATE_LIMIT_FAMILIES[name].relaxable, `${name} must not be relaxable`).toBe(false);
        expect(RATE_LIMIT_FAMILIES[name].scope, `${name} must be IP-scoped`).toBe('ip');
      }
    });
  });

  describe('ordinary authenticated reads', () => {
    it('allows well past the old 150-request blanket ceiling, even in production', async () => {
      const { productDataRateLimit, resolveFamilyLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      expect(resolveFamilyLimit('read')).toBeGreaterThan(1000);

      const app = buildApp(productDataRateLimit(), 'user-read-headroom');
      const statuses = await drain(app, 200);

      expect(statuses.every((status) => status === 200)).toBe(true);
    });

    it('keeps reads and writes in separate buckets', async () => {
      const { importSessionRateLimit, resolveFamilyLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      const writeCeiling = resolveFamilyLimit('importSession');
      const app = buildApp(importSessionRateLimit(), 'user-split-buckets');

      const writes = await drain(app, writeCeiling + 1, 'post');
      expect(writes[writeCeiling - 1]).toBe(200);
      expect(writes[writeCeiling]).toBe(429);

      // Exhausting the write budget must not close the (much larger) read budget.
      await request(app).get('/thing').expect(200);
    });

    it('does not let one user consume another user’s budget', async () => {
      const { importSessionRateLimit, resolveFamilyLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      const writeCeiling = resolveFamilyLimit('importSession');
      const limiter = importSessionRateLimit();

      const noisy = buildApp(limiter, 'user-noisy');
      const quiet = buildApp(limiter, 'user-quiet');

      const statuses = await drain(noisy, writeCeiling + 1, 'post');
      expect(statuses[writeCeiling]).toBe(429);

      // Same limiter instance, same source IP, different verified subject.
      await request(quiet).post('/thing').expect(200);
    });
  });

  describe('keying', () => {
    it('keys on the verified Supabase subject when there is one', async () => {
      const { buildRateLimitKey } = await loadRateLimitModule(PRODUCTION_ENV);
      const req = { authUser: { user: { id: 'sub-123' } }, ip: '203.0.113.5' } as unknown as Request;

      expect(buildRateLimitKey(req, 'identity')).toBe('u:sub-123');
    });

    it('falls back to the resolved app user when only that is present', async () => {
      const { buildRateLimitKey } = await loadRateLimitModule(PRODUCTION_ENV);
      const req = { ip: '203.0.113.5', user: { appuserKey: 42 } } as unknown as Request;

      expect(buildRateLimitKey(req, 'identity')).toBe('u:42');
    });

    it('falls back to IP when the request carries no verified identity', async () => {
      const { buildRateLimitKey } = await loadRateLimitModule(PRODUCTION_ENV);
      const req = { ip: '203.0.113.5' } as unknown as Request;

      expect(buildRateLimitKey(req, 'identity')).toBe('ip:203.0.113.5');
    });

    it('ignores client-supplied identity hints entirely', async () => {
      const { buildRateLimitKey } = await loadRateLimitModule(PRODUCTION_ENV);
      const req = {
        body: { appuserKey: 'attacker-chosen', sub: 'attacker-chosen' },
        headers: {
          authorization: 'Bearer forged',
          'x-appuser-key': 'attacker-chosen',
          'x-user-id': 'attacker-chosen',
        },
        ip: '203.0.113.9',
        query: { sub: 'attacker-chosen', userId: 'attacker-chosen' },
      } as unknown as Request;

      // Nothing the caller controls can move the bucket off its IP.
      expect(buildRateLimitKey(req, 'identity')).toBe('ip:203.0.113.9');
    });

    it('always uses IP for ip-scoped families, even for an authenticated caller', async () => {
      const { buildRateLimitKey } = await loadRateLimitModule(PRODUCTION_ENV);
      const req = { authUser: { user: { id: 'sub-123' } }, ip: '203.0.113.7' } as unknown as Request;

      expect(buildRateLimitKey(req, 'ip')).toBe('ip:203.0.113.7');
    });

    it('separates unauthenticated callers by source address', async () => {
      const { publicMarketingRateLimit, resolveFamilyLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      const ceiling = resolveFamilyLimit('publicMarketing');
      const app = buildApp(publicMarketingRateLimit());

      const first = await drain(app, ceiling + 1, 'get', '198.51.100.1');
      expect(first[ceiling]).toBe(429);

      // A different address still has its own full budget.
      await request(app).get('/thing').set('X-Forwarded-For', '198.51.100.2').expect(200);
    });
  });

  describe('the non-production escape hatch is server-side only', () => {
    it('is off in production regardless of what the request claims', async () => {
      const { adminApiRateLimit, RELAXED_MULTIPLIER, resolveFamilyLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      expect(RELAXED_MULTIPLIER).toBe(1);
      expect(resolveFamilyLimit('read')).toBe(1200);

      const app = buildApp(adminApiRateLimit());
      const spoofHeaders = {
        'x-app-env': 'development',
        'x-deploy-env': 'development',
        'x-node-env': 'development',
        'x-rate-limit-bypass': 'true',
        'x-rate-limit-relaxed-multiplier': '1000',
      };

      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const response = await request(app)
          .get('/thing?APP_ENV=development&RATE_LIMIT_RELAXED_MULTIPLIER=1000')
          .set(spoofHeaders)
          .set('X-Forwarded-For', '198.51.100.77');
        statuses.push(response.status);
      }

      expect(statuses[5]).toBe(429);
    });

    it('relaxes the relaxable families outside production, and only those', async () => {
      const { RELAXED_MULTIPLIER, resolveFamilyLimit } = await loadRateLimitModule(STAGING_ENV);

      expect(RELAXED_MULTIPLIER).toBe(10);
      expect(resolveFamilyLimit('read')).toBe(1200 * 10);
      expect(resolveFamilyLimit('adminApi')).toBe(5);
    });

    // RAD-567 — the multiplier is a code constant now. An env var of the same name was
    // never set in any environment, so it only ever added a second source of truth.
    it('ignores a RATE_LIMIT_RELAXED_MULTIPLIER left over in the environment', async () => {
      const { RELAXED_MULTIPLIER } = await loadRateLimitModule({
        ...STAGING_ENV,
        RATE_LIMIT_RELAXED_MULTIPLIER: '1000',
      });

      expect(RELAXED_MULTIPLIER).toBe(10);
    });

    it('never relaxes production', async () => {
      const { RELAXED_MULTIPLIER } = await loadRateLimitModule({
        ...PRODUCTION_ENV,
        RATE_LIMIT_RELAXED_MULTIPLIER: '1000',
      });

      expect(RELAXED_MULTIPLIER).toBe(1);
    });
  });

  describe('the 429 response', () => {
    it('carries Retry-After and a machine-readable body', async () => {
      const { adminApiRateLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      const app = buildApp(adminApiRateLimit());

      await drain(app, 5, 'get', '198.51.100.55');
      const response = await request(app).get('/thing').set('X-Forwarded-For', '198.51.100.55');

      expect(response.status).toBe(429);

      const retryAfter = Number(response.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);

      expect(response.body).toMatchObject({ code: 'RATE_LIMITED', family: 'adminApi', retryAfter });
      expect(typeof response.body.message).toBe('string');
    });

    it('advertises the remaining budget on a successful request', async () => {
      const { adminApiRateLimit } = await loadRateLimitModule(PRODUCTION_ENV);
      const app = buildApp(adminApiRateLimit());

      const response = await request(app).get('/thing').set('X-Forwarded-For', '198.51.100.56');

      expect(response.status).toBe(200);
      expect(response.headers['ratelimit']).toContain('limit=5');
    });
  });

  describe('healthcheck exemption', () => {
    it('skips the container healthcheck so a redeploy cannot be marked unhealthy', async () => {
      const { isHealthCheckPath } = await loadRateLimitModule(PRODUCTION_ENV);

      expect(isHealthCheckPath({ path: '/v1/health' } as Request)).toBe(true);
      expect(isHealthCheckPath({ path: '/v1/health/deep' } as Request)).toBe(true);
      expect(isHealthCheckPath({ path: '/v1/budget' } as Request)).toBe(false);
    });
  });
});

/**
 * RAD-567 — a 429 deliberately bypasses the shared error handler, so before this the only
 * trace of a badly-sized ceiling was a `warn` line. The ceilings were sized from an
 * estimate rather than measured traffic, so being able to see one bite matters.
 */
describe('breach observability (RAD-567)', () => {
  // Reset *before* each case: the suites above this one also produce 429s, and the mock is
  // module-level, so an afterEach here would leave their calls on the counter.
  beforeEach(() => {
    sentry.addBreadcrumb.mockReset();
    sentry.captureMessage.mockReset();
  });

  it('leaves a breadcrumb on a 429 without raising an event', async () => {
    const { adminApiRateLimit } = await loadRateLimitModule(PRODUCTION_ENV);
    const app = buildApp(adminApiRateLimit());

    await drain(app, 6, 'get', '9.9.9.1');

    expect(sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'rate-limit', level: 'warning' }),
    );
    // One breach is not an incident.
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('raises one event per family once a family breaches repeatedly, then stays quiet', async () => {
    const { adminApiRateLimit, RATE_LIMIT_REPORT_THRESHOLD } = await loadRateLimitModule(PRODUCTION_ENV);
    const app = buildApp(adminApiRateLimit());

    // 5 allowed, then enough 429s to cross the threshold twice over.
    await drain(app, 5 + RATE_LIMIT_REPORT_THRESHOLD * 2, 'get', '9.9.9.2');

    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('adminApi'),
      expect.objectContaining({ level: 'warning', tags: expect.objectContaining({ family: 'adminApi' }) }),
    );
  });

  it('counts each family separately, so a noisy one cannot mask another', async () => {
    const { adminApiRateLimit, RATE_LIMIT_REPORT_THRESHOLD, resetRateLimitBreachCounters } =
      await loadRateLimitModule(PRODUCTION_ENV);
    resetRateLimitBreachCounters();

    const app = buildApp(adminApiRateLimit());
    // One short of the threshold: still nothing reported.
    await drain(app, 5 + RATE_LIMIT_REPORT_THRESHOLD - 1, 'get', '9.9.9.3');

    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});

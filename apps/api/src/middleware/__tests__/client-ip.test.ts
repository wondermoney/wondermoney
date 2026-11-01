import type { Server } from 'node:http';

import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrustProxySetting } from '@config/trust-proxy';

import { BETTER_AUTH_IP_ADDRESS_OPTIONS, configureClientIp } from '../client-ip';

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));

// What the proxy in front of the API would write. supertest always connects from loopback, so
// these headers are the only way to make requests look like they come from different clients.
const CLIENT_A = '198.51.100.10';
const CLIENT_B = '203.0.113.20';

const openServers: Server[] = [];

// better-auth keeps its in-memory limiter store at module scope, shared by every instance in
// this file, so each better-auth case takes addresses no earlier case has used.
let nextClientOctet = 1;
function freshClients(): [string, string] {
  const a = `192.0.2.${nextClientOctet++}`;
  const b = `192.0.2.${nextClientOctet++}`;
  return [a, b];
}

/**
 * A real better-auth instance with the API's IP options and its limiter switched on (it is
 * off outside production by default). `/api/auth/ok` needs no database, and better-auth's
 * limiter runs before any endpoint, so the 429 is better-auth's own decision.
 */
function buildBetterAuthHandler(max: number): RequestHandler {
  const auth = betterAuth({
    advanced: { ipAddress: BETTER_AUTH_IP_ADDRESS_OPTIONS },
    basePath: '/api/auth',
    baseURL: 'http://localhost:3001',
    rateLimit: { enabled: true, max, storage: 'memory', window: 60 },
    secret: 'test-secret-that-is-long-enough-for-better-auth',
  });
  return toNodeHandler(auth);
}

/** The API's wiring order: trust setting and client-IP stamp first, then limiters and handlers. */
function buildApp(trustProxy: TrustProxySetting, mount: (app: express.Express) => void): Server {
  const app = express();
  configureClientIp(app, trustProxy);
  mount(app);
  const server = app.listen(0);
  openServers.push(server);
  return server;
}

async function exhaust(server: Server, path: string, count: number, forwardedFor?: string): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    expect(await statusFrom(server, path, forwardedFor)).toBe(200);
  }
}

async function statusFrom(server: Server, path: string, forwardedFor?: string): Promise<number> {
  const pending = request(server).get(path);
  if (forwardedFor) pending.set('X-Forwarded-For', forwardedFor);
  return (await pending).status;
}

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise((done) => server.close(done))));
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('client IP for rate limiting', () => {
  describe('the API limiters (express-rate-limit)', () => {
    async function inviteLookupLimiter() {
      const { inviteLookupRateLimit, RATE_LIMIT_FAMILIES } = await import('../rate-limit');
      return { limit: RATE_LIMIT_FAMILIES.inviteLookup.limit, limiter: inviteLookupRateLimit() };
    }

    it('ignores a client-supplied X-Forwarded-For when no proxy is trusted', async () => {
      const { limit, limiter } = await inviteLookupLimiter();
      const server = buildApp(false, (app) => app.get('/thing', limiter, (_req, res) => res.json({ ok: true })));

      await exhaust(server, '/thing', limit, CLIENT_A);

      // Rotating the header would otherwise be a fresh bucket per request.
      expect(await statusFrom(server, '/thing', CLIENT_B)).toBe(429);
      expect(await statusFrom(server, '/thing')).toBe(429);
    });

    it('gives each client its own bucket behind one trusted proxy', async () => {
      const { limit, limiter } = await inviteLookupLimiter();
      const server = buildApp(1, (app) => app.get('/thing', limiter, (_req, res) => res.json({ ok: true })));

      await exhaust(server, '/thing', limit, CLIENT_A);

      expect(await statusFrom(server, '/thing', CLIENT_A)).toBe(429);
      expect(await statusFrom(server, '/thing', CLIENT_B)).toBe(200);
    });

    it('keys on the address the trusted proxy saw, not one the client prepended', async () => {
      const { limit, limiter } = await inviteLookupLimiter();
      const server = buildApp(1, (app) => app.get('/thing', limiter, (_req, res) => res.json({ ok: true })));

      await exhaust(server, '/thing', limit, CLIENT_A);

      // The proxy appends the real peer; whatever the client sent sits to its left.
      expect(await statusFrom(server, '/thing', `${CLIENT_B}, ${CLIENT_A}`)).toBe(429);
    });

    it('honours a trusted proxy given by address', async () => {
      const { limit, limiter } = await inviteLookupLimiter();
      const server = buildApp(['loopback'], (app) => app.get('/thing', limiter, (_req, res) => res.json({ ok: true })));

      await exhaust(server, '/thing', limit, CLIENT_A);

      expect(await statusFrom(server, '/thing', CLIENT_B)).toBe(200);
    });
  });

  describe("better-auth's own limiter", () => {
    const BETTER_AUTH_MAX = 2;

    function buildAuthApp(trustProxy: TrustProxySetting): Server {
      const handler = buildBetterAuthHandler(BETTER_AUTH_MAX);
      return buildApp(trustProxy, (app) => app.all('/api/auth/*splat', handler));
    }

    it('gives each client its own bucket behind one trusted proxy', async () => {
      const [clientA, clientB] = freshClients();
      const server = buildAuthApp(1);

      await exhaust(server, '/api/auth/ok', BETTER_AUTH_MAX, clientA);

      expect(await statusFrom(server, '/api/auth/ok', clientA)).toBe(429);
      expect(await statusFrom(server, '/api/auth/ok', clientB)).toBe(200);
    });

    // better-auth on its own only trusts a single-entry X-Forwarded-For. A chain (anything the
    // client prepended, or a second proxy) would drop every user into one shared bucket.
    it('keys a proxied chain on the real client, not one shared bucket', async () => {
      const [clientA, clientB] = freshClients();
      const server = buildAuthApp(1);

      for (let i = 0; i < BETTER_AUTH_MAX; i += 1) {
        expect(await statusFrom(server, '/api/auth/ok', `10.9.9.${i}, ${clientA}`)).toBe(200);
      }

      expect(await statusFrom(server, '/api/auth/ok', `10.9.9.99, ${clientA}`)).toBe(429);
      expect(await statusFrom(server, '/api/auth/ok', `10.9.9.99, ${clientB}`)).toBe(200);
    });

    it('ignores a client-supplied X-Forwarded-For when no proxy is trusted', async () => {
      const [clientA, clientB] = freshClients();
      const server = buildAuthApp(false);

      await exhaust(server, '/api/auth/ok', BETTER_AUTH_MAX, clientA);

      expect(await statusFrom(server, '/api/auth/ok', clientB)).toBe(429);
    });

    it('ignores a forged client-IP header', async () => {
      const [clientA, clientB] = freshClients();
      const server = buildAuthApp(1);

      await exhaust(server, '/api/auth/ok', BETTER_AUTH_MAX, clientA);

      const forged = await request(server)
        .get('/api/auth/ok')
        .set('X-Forwarded-For', clientA)
        .set('X-WonderMoney-Client-IP', clientB);
      expect(forged.status).toBe(429);
    });
  });
});

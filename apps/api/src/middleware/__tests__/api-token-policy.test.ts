import type { Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  API_TOKEN_FORBIDDEN_MOUNTS,
  API_TOKEN_READ_MOUNTS,
  API_TOKEN_WRITE_RESOURCE_MOUNTS,
  API_TOKEN_WRITE_ROUTES,
  apiTokenScopesForRequest,
  pathMatches,
} from '@middleware/api-token-policy';

/**
 * The scope allowlist is the security boundary for personal API tokens. This test walks
 * every router mounted behind `requireAuth` and fails when a route is neither allowed nor
 * explicitly classified as forbidden — so a new write route cannot silently become reachable
 * by a token, and a new mount cannot silently join the allowlist.
 *
 * The controllers are stubbed: only the route table matters here.
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
vi.mock('@controller/user', controllerStub);
vi.mock('@controller/user-preferences', controllerStub);
vi.mock('@controller/watchlist', controllerStub);

const passthrough = (_req: unknown, _res: unknown, next: () => void) => { next(); };
vi.mock('@middleware/ai-allowance', () => ({ requireAiAllowance: () => passthrough }));
vi.mock('@middleware/demo', () => ({ blockDemoStateChange: passthrough }));
vi.mock('@middleware/email-verification', () => ({ requireVerifiedEmailForAi: passthrough }));
vi.mock('@middleware/household', () => ({ requireHouseholdOwner: passthrough }));
vi.mock('@middleware/multer', () => ({ default: passthrough }));
vi.mock('@middleware/sensitive-session', () => ({ requireSensitiveSession: passthrough }));

/** Every router mounted behind `requireAuth` in `app.ts`, keyed by its mount path. */
const AUTHED_MOUNTS: Record<string, () => Promise<Router>> = {
  '/v1/account': async () => (await import('@route/account')).default,
  '/v1/assistant': async () => (await import('@route/assistant')).default,
  '/v1/banking': async () => (await import('@route/banking')).default,
  '/v1/budget': async () => (await import('@route/budget')).default,
  '/v1/category': async () => (await import('@route/category')).default,
  '/v1/configs': async () => (await import('@route/configs')).default,
  '/v1/currency': async () => (await import('@route/currency')).default,
  '/v1/feedback': async () => (await import('@route/feedback')).default,
  '/v1/financial-markets': async () => (await import('@route/financial-markets')).default,
  '/v1/goals': async () => (await import('@route/goal')).default,
  '/v1/household': async () => (await import('@route/household')).default,
  '/v1/loan': async () => (await import('@route/loan')).default,
  '/v1/manual-assets': async () => (await import('@route/manual-asset')).default,
  '/v1/net-worth': async () => (await import('@route/net-worth')).default,
  '/v1/operations': async () => (await import('@route/background-operation')).default,
  '/v1/portfolio': async () => (await import('@route/portfolio')).default,
  '/v1/portfolio-import-sessions': async () => (await import('@route/portfolio-import-session')).default,
  '/v1/recurring': async () => (await import('@route/recurring')).default,
  '/v1/reports': async () => (await import('@route/reports')).default,
  '/v1/rule': async () => (await import('@route/rule')).default,
  '/v1/tag': async () => (await import('@route/tag')).default,
  '/v1/transaction-import-sessions': async () => (await import('@route/transaction-import')).default,
  '/v1/user': async () => (await import('@route/user')).default,
};

interface DiscoveredRoute {
  method: string;
  mount: string;
  path: string;
}

async function allRoutes(): Promise<DiscoveredRoute[]> {
  const routes: DiscoveredRoute[] = [];
  for (const [mount, load] of Object.entries(AUTHED_MOUNTS)) {
    routes.push(...routesOf(await load(), mount));
  }
  return routes;
}

function routesOf(router: Router, mount: string): DiscoveredRoute[] {
  const stack = (router as unknown as { stack: { route?: { methods: Record<string, boolean>; path: string } }[] }).stack;
  return stack.flatMap((layer) => {
    if (!layer.route) return [];
    return Object.keys(layer.route.methods).map((method) => ({
      method: method.toUpperCase(),
      mount,
      path: layer.route?.path ?? '',
    }));
  });
}

const routeKey = (route: { method: string; mount: string; path: string }) => `${route.mount} ${route.method} ${route.path}`;
const writeKeys = new Set(API_TOKEN_WRITE_ROUTES.map(routeKey));

describe('API token scope policy', () => {
  it('allows reads on every GET of the five write resources', async () => {
    for (const mount of API_TOKEN_WRITE_RESOURCE_MOUNTS) {
      const load = AUTHED_MOUNTS[mount];
      if (!load) throw new Error(`write resource mount ${mount} is not mounted`);
      const routes = routesOf(await load(), mount).filter((route) => route.method === 'GET');
      expect(routes.length).toBeGreaterThan(0);
      for (const route of routes) {
        expect(apiTokenScopesForRequest(route.mount, route.method, route.path)).toContain('read');
      }
    }
  });

  it('classifies every mount behind requireAuth as readable or forbidden', () => {
    for (const mount of Object.keys(AUTHED_MOUNTS)) {
      const classified = API_TOKEN_READ_MOUNTS.has(mount) || API_TOKEN_FORBIDDEN_MOUNTS.has(mount);
      expect(classified, `mount ${mount} is neither in the read allowlist nor the forbidden list`).toBe(true);
    }
  });

  it('walks every mounted route and allows only the explicitly classified writes', async () => {
    const violations: string[] = [];
    for (const route of await allRoutes()) {
      const scopes = apiTokenScopesForRequest(route.mount, route.method, route.path);
      const isRead = route.method === 'GET' || route.method === 'HEAD';
      // Reads are allowed exactly on the read mounts; every other method only when it is one
      // of the explicit create/update routes.
      const shouldAllow = isRead ? API_TOKEN_READ_MOUNTS.has(route.mount) : writeKeys.has(routeKey(route));
      const allowed = scopes.length > 0;
      if (allowed !== shouldAllow) {
        violations.push(`${routeKey(route)} allowed=${allowed} expected=${shouldAllow}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no dead allowlist entry: every write route matches a real mounted route', async () => {
    const real = new Set((await allRoutes()).map(routeKey));
    for (const key of writeKeys) {
      expect(real.has(key), `API_TOKEN_WRITE_ROUTES entry ${key} does not match a mounted route`).toBe(true);
    }
  });

  it('gives a write token exactly the create/update routes and never a delete', () => {
    for (const route of API_TOKEN_WRITE_ROUTES) {
      expect(apiTokenScopesForRequest(route.mount, route.method, route.path)).toEqual(['write']);
    }
  });

  it('keeps MCP token authority at the upstream-defined POST mount scope', () => {
    expect(apiTokenScopesForRequest('/v1/mcp', 'POST', '/')).toEqual(['mcp:read']);
    expect(apiTokenScopesForRequest('/v1/mcp', 'POST', '/other')).toEqual(['mcp:read']);
    expect(apiTokenScopesForRequest('/v1/mcp', 'GET', '/')).toEqual([]);
  });

  it('never lets a token reach a forbidden mount, whatever the method', () => {
    for (const mount of API_TOKEN_FORBIDDEN_MOUNTS) {
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        expect(apiTokenScopesForRequest(mount, method, '/anything')).toEqual([]);
      }
    }
  });

  it('gives mcp:read exactly the MCP endpoint, and keeps it off the data routes', () => {
    expect(apiTokenScopesForRequest('/v1/mcp', 'POST', '/')).toEqual(['mcp:read']);
    expect(apiTokenScopesForRequest('/v1/mcp', 'GET', '/')).toEqual([]);
    expect(apiTokenScopesForRequest('/v1/account', 'GET', '/')).not.toContain('mcp:read');
  });

  it('does not allow an unknown mount by accident', () => {
    expect(apiTokenScopesForRequest('/v1/something-new', 'GET', '/')).toEqual([]);
    expect(apiTokenScopesForRequest('/v1/something-new', 'POST', '/')).toEqual([]);
  });

  it('keeps the read allowlist disjoint from the forbidden list', () => {
    for (const mount of API_TOKEN_READ_MOUNTS) {
      expect(API_TOKEN_FORBIDDEN_MOUNTS.has(mount)).toBe(false);
    }
  });

  it('keeps every write-resource mount readable', () => {
    for (const mount of API_TOKEN_WRITE_RESOURCE_MOUNTS) {
      expect(API_TOKEN_READ_MOUNTS.has(mount)).toBe(true);
    }
  });

  it('matches parameterised paths without matching extra segments', () => {
    expect(pathMatches('/:accountId/transaction', '/42/transaction')).toBe(true);
    expect(pathMatches('/:accountId/transaction', '/42/transaction/extra')).toBe(false);
    expect(pathMatches('/transaction/:transactionId', '/transaction/abc')).toBe(true);
    expect(pathMatches('/transaction/:transactionId', '/transaction')).toBe(false);
    expect(pathMatches('/', '/')).toBe(true);
  });
});

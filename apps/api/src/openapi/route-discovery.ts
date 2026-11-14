import type { Router } from 'express';

/**
 * Every router mounted behind `requireAuth` in `app.ts`, keyed by its mount path.
 *
 * This is the one route table the API-token policy test and the public OpenAPI generator both
 * walk. Keeping it here means a router added to `app.ts` and to this map is automatically
 * classified by the policy test, and automatically becomes a candidate for the public spec.
 * A router added to `app.ts` but not here is still caught: `api-token-policy.test.ts` asserts
 * the map covers every mount behind `requireAuth`.
 *
 * The imports are dynamic so a test can stub the controllers (`vi.mock`) and only pay for the
 * route table, while the generator imports the real modules.
 */
export const AUTHED_MOUNTS: Record<string, () => Promise<Router>> = {
  '/v1/account': async () => (await import('@route/account')).default,
  '/v1/assistant': async () => (await import('@route/assistant')).default,
  '/v1/banking': async () => (await import('@route/banking')).default,
  '/v1/budget': async () => (await import('@route/budget')).default,
  '/v1/category': async () => (await import('@route/category')).default,
  '/v1/configs': async () => (await import('@route/configs')).default,
  '/v1/currency': async () => (await import('@route/currency')).default,
  '/v1/expense-groups': async () => (await import('@route/expense-group')).default,
  '/v1/feedback': async () => (await import('@route/feedback')).default,
  '/v1/financial-markets': async () => (await import('@route/financial-markets')).default,
  '/v1/goals': async () => (await import('@route/goal')).default,
  '/v1/household': async () => (await import('@route/household')).default,
  '/v1/insights': async () => (await import('@route/insights')).default,
  '/v1/installment-plans': async () => (await import('@route/installment-plan')).default,
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
  '/v1/transaction-template': async () => (await import('@route/transaction-template')).default,
  '/v1/user': async () => (await import('@route/user')).default,
};

export interface DiscoveredRoute {
  method: string;
  mount: string;
  path: string;
}

/** The routes a router declares, with the mount path that prefixes them. */
export function routesOf(router: Router, mount: string): DiscoveredRoute[] {
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

/** Walk every authenticated mount and return its declared routes. */
export async function discoverAuthedRoutes(): Promise<DiscoveredRoute[]> {
  const routes: DiscoveredRoute[] = [];
  for (const [mount, load] of Object.entries(AUTHED_MOUNTS)) {
    routes.push(...routesOf(await load(), mount));
  }
  return routes;
}

/** The full path of a discovered route, without a trailing slash except at the root. */
export function fullPath(route: DiscoveredRoute): string {
  const path = `${route.mount}${route.path}`;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** `GET /v1/account/transaction/:transactionId` -> the catalog key. */
export function routeKey(route: { method: string; mount: string; path: string }): string {
  return `${route.method.toUpperCase()} ${fullPath(route)}`;
}

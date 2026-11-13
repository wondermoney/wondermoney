import type { Request } from 'express';

import type { ApiTokenScope } from '@entity/ApiToken';

/**
 * The one place that decides what a personal API token may reach.
 *
 * Default deny: a token gets a route only when it appears below. `write` implies `read` on
 * the five resources it can change, because a script that writes a transaction usually reads
 * it back. Nothing in this list can delete, import, recalculate, manage the household or the
 * bank connection, reach `/v1/user` (profile, exports, restores, account deletion, token
 * management) or `/v1/banking`.
 *
 * `apiTokenScopesForRequest` is called from `requireAuth`, so every route mounted behind it
 * is covered by one check. `api-token-policy.test.ts` walks the mounted routers and fails
 * when a new route is neither allowed nor explicitly classified as forbidden.
 */

/**
 * The scopes that reach the MCP server. `mcp:read` exposes the read tools; `mcp:propose` the
 * `propose_*` tools, which draft a change the person confirms in the app. No scope can apply a
 * proposal: `POST /v1/assistant/proposals/:id/apply` is in no allowlist below, so every token
 * gets 403 there.
 */
export const MCP_SCOPES: readonly ApiTokenScope[] = ['mcp:read', 'mcp:propose'];

/**
 * Mounts where `write` also grants reads: exactly the resources a write token can change.
 * Everywhere else a write token is a write token — it cannot read reports, portfolios or
 * the assistant unless it also carries `read`.
 */
export const API_TOKEN_WRITE_RESOURCE_MOUNTS: ReadonlySet<string> = new Set([
  '/v1/account',
  '/v1/budget',
  '/v1/category',
  '/v1/goals',
]);

/** Mounts a read token may GET. Everything not listed is forbidden. */
export const API_TOKEN_READ_MOUNTS: ReadonlySet<string> = new Set([
  '/v1/account',
  '/v1/assistant',
  '/v1/budget',
  '/v1/category',
  '/v1/configs',
  '/v1/currency',
  '/v1/financial-markets',
  '/v1/goals',
  '/v1/installment-plans',
  '/v1/loan',
  '/v1/manual-assets',
  '/v1/net-worth',
  '/v1/operations',
  '/v1/portfolio',
  '/v1/portfolio-import-sessions',
  '/v1/recurring',
  '/v1/reports',
  '/v1/rule',
  '/v1/tag',
  '/v1/transaction-import-sessions',
]);

/** Mounts a token may never reach, whatever its scopes. Kept explicit for the forbidden-route test. */
export const API_TOKEN_FORBIDDEN_MOUNTS: ReadonlySet<string> = new Set([
  '/api/auth',
  '/v1/admin',
  // Instance-wide sync health. Mounted outside `requireAuth`; `requireInstanceAdmin` answers a
  // token with 404 itself, whatever its scopes or whose it is.
  '/v1/admin/bank-sync',
  '/v1/auth',
  '/v1/banking',
  // Reachable only with a `calendar:read` token in the query string, never as a bearer.
  '/v1/calendar',
  '/v1/feedback',
  '/v1/household',
  '/v1/support',
  '/v1/user',
]);

interface WriteRoute {
  method: 'PATCH' | 'POST' | 'PUT';
  mount: string;
  path: string;
}

/**
 * Create and update on transactions, accounts, categories, budgets and goals.
 * Deletes, imports, OCR, recalculations and account uploads are deliberately absent.
 */
export const API_TOKEN_WRITE_ROUTES: readonly WriteRoute[] = [
  { method: 'POST', mount: '/v1/account', path: '/offline' },
  { method: 'PATCH', mount: '/v1/account', path: '/transaction' },
  { method: 'PATCH', mount: '/v1/account', path: '/transaction/:transactionId' },
  { method: 'PUT', mount: '/v1/account', path: '/transaction/:transactionId/tags' },
  { method: 'PUT', mount: '/v1/account', path: '/transaction/:transactionId/splits' },
  // Linking a refund to an expense edits two transactions' totals, nothing else; unlinking is a delete.
  { method: 'POST', mount: '/v1/account', path: '/transaction/:transactionId/reimbursements' },
  { method: 'PATCH', mount: '/v1/account', path: '/:accountId' },
  { method: 'POST', mount: '/v1/account', path: '/:accountId/transaction' },

  { method: 'POST', mount: '/v1/category', path: '/' },
  { method: 'PATCH', mount: '/v1/category', path: '/:categoryId' },

  { method: 'POST', mount: '/v1/budget', path: '/' },
  { method: 'PATCH', mount: '/v1/budget', path: '/:budgetKey' },
  { method: 'POST', mount: '/v1/budget', path: '/:budgetKey/category' },
  { method: 'PATCH', mount: '/v1/budget', path: '/:budgetKey/accounts' },
  { method: 'PATCH', mount: '/v1/budget', path: '/:budgetKey/:budgetTemplateCategoryKey' },
  { method: 'PATCH', mount: '/v1/budget', path: '/:budgetKey/:year/:month/:categoryKey' },

  { method: 'POST', mount: '/v1/goals', path: '/' },
  { method: 'PATCH', mount: '/v1/goals', path: '/:goalKey' },
  { method: 'POST', mount: '/v1/goals', path: '/:goalKey/assign' },
  { method: 'POST', mount: '/v1/goals', path: '/:goalKey/move-out' },
  { method: 'POST', mount: '/v1/goals', path: '/:goalKey/fund-transaction' },
  { method: 'POST', mount: '/v1/goals', path: '/:goalKey/accounts' },
  { method: 'POST', mount: '/v1/goals', path: '/:goalKey/restore' },
];

/** Normalise the request path so `/v1/account` and `/v1/account/` compare the same. */
function normalisePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/** Compare an Express path pattern (`/:accountId/transaction`) with a concrete request path. */
export function pathMatches(pattern: string, path: string): boolean {
  const patternSegments = normalisePath(pattern).split('/');
  const pathSegments = normalisePath(path).split('/');
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => {
    const candidate = pathSegments[index] ?? '';
    return segment.startsWith(':') ? candidate.length > 0 : segment === candidate;
  });
}

/**
 * The scopes that may perform this request, or `[]` when the route is forbidden to tokens.
 * A caller allows the request when the token carries at least one of the returned scopes.
 */
export function apiTokenScopesForRequest(mount: string, method: string, path: string): ApiTokenScope[] {
  const normalisedMount = normalisePath(mount);
  const normalisedMethod = method.toUpperCase();

  /*
   * The MCP endpoint is mounted outside `requireAuth` and resolves its own token
   * (`middleware/mcp-auth.ts`), so this branch is documentation as much as policy: the only
   * credential that reaches it is a token carrying `mcp:read` or `mcp:propose`, and a plain
   * `read` or `write` token does not. Keeping it here means the scope map stays one place.
   */
  if (normalisedMount === '/v1/mcp' && normalisedMethod === 'POST') return [...MCP_SCOPES];

  if (normalisedMethod === 'GET' || normalisedMethod === 'HEAD') {
    if (!API_TOKEN_READ_MOUNTS.has(normalisedMount)) return [];
    // `write` implies `read` only on the resources it can change, not on every read surface.
    return API_TOKEN_WRITE_RESOURCE_MOUNTS.has(normalisedMount) ? ['read', 'write'] : ['read'];
  }

  if (normalisedMethod === 'POST' || normalisedMethod === 'PATCH' || normalisedMethod === 'PUT') {
    const match = API_TOKEN_WRITE_ROUTES.some(
      (route) =>
        route.method === normalisedMethod &&
        route.mount === normalisedMount &&
        pathMatches(route.path, normalisePath(path)),
    );
    return match ? ['write'] : [];
  }

  return [];
}

/** Throw-free predicate used by `requireAuth`; the middleware turns `false` into a 403. */
export function isApiTokenRequestAllowed(req: Request): boolean {
  const scopes = apiTokenScopesForRequest(req.baseUrl, req.method, req.path);
  return scopes.some((scope) => req.apiToken?.scopes.includes(scope));
}

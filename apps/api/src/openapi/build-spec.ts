import { OpenApiGeneratorV31, OpenAPIRegistry, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { apiTokenScopesForRequest } from '@middleware/api-token-policy';

// Extend Zod before route-catalog imports validators that register/refine OpenAPI schemas.
import './zod-openapi';

import { type OperationDefinition, OPERATIONS } from './route-catalog';
import { discoverAuthedRoutes, type DiscoveredRoute, fullPath } from './route-discovery';

/**
 * Builds the published OpenAPI document for personal API tokens.
 *
 * The route set is not written by hand: it is the mounted routers filtered through
 * `api-token-policy.ts`, the same allowlist `requireAuth` enforces. `OPERATIONS` supplies the
 * documentation for each allowed route, and this module fails when the two disagree in either
 * direction — a token-callable route without docs, or docs for a route a token cannot reach.
 */

const HTTP_METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

const TAG_DESCRIPTIONS: Record<string, string> = {
  Accounts: 'Bank and manual accounts, balances, account types and cashflow.',
  Assistant: 'The AI assistant’s consent state and audit log.',
  Budgets: 'Budgets, their templates and category amounts.',
  Categories: 'Transaction categories.',
  Config: 'Client configuration: brokers, currencies, categories and transaction types.',
  Currency: 'Exchange-rate overrides.',
  'Financial markets': 'Quotes, fundamentals and news from the configured market-data provider.',
  Goals: 'Savings goals and the money assigned to them.',
  'Import sessions': 'Read the state of a CSV or portfolio import session.',
  Loans: 'Loans, repayment schedules and payoff projections.',
  'Manual assets': 'Assets tracked by hand, with their valuations.',
  MCP: 'Model Context Protocol over stateless JSON-RPC HTTP.',
  'Net worth': 'Current net worth and its history.',
  Operations: 'Background operations started by other endpoints.',
  Portfolio: 'Portfolios, holdings, performance and dividend income.',
  Recurring: 'Detected recurring series and their occurrences.',
  Reports: 'Spending, cashflow, net worth and portfolio reports, as JSON or CSV.',
  Rules: 'Transaction categorisation rules.',
  Tags: 'Transaction tags.',
  Transactions: 'Transactions, their history, splits, tags and attachments.',
};

const ERROR_RESPONSES = {
  401: 'The token is missing, malformed or revoked.',
  403: 'The token does not carry a scope this operation accepts.',
  422: 'The request did not match the endpoint’s validator.',
  429: 'A rate limit was exceeded. Honour the `Retry-After` header.',
} as const;

/** The `{ body, params, query }` envelope a controller parses, unwrapped from any refinement. */
function envelopeOf(schema: undefined | z.ZodTypeAny): {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
} {
  if (!schema) return {};
  let current: unknown = schema;
  // `.refine()` on an envelope wraps it; the fields still live on the inner object.
  while (current && typeof (current as { shape?: unknown }).shape !== 'object') {
    current = (current as { _def?: { schema?: unknown } })._def?.schema;
    if (!current) return {};
  }
  const shape = (current as { shape: Record<string, z.ZodTypeAny> }).shape;
  return { body: shape['body'], params: shape['params'], query: shape['query'] };
}

/** `/v1/account/:accountId` -> `/v1/account/{accountId}`. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

function pathParameterNames(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '');
}

/** The scope sentence shown at the top of every operation description. */
export interface PublicSpecResult {
  document: Record<string, unknown>;
  /** The token-callable routes discovered from the mounted routers. */
  routes: { method: string; path: string; scopes: string[] }[];
}

function scopeSentence(scopes: string[]): string {
  if (scopes.length === 1) return `**Required scope:** \`${scopes[0]}\`.`;
  return `**Required scope:** any of ${scopes.map((scope) => `\`${scope}\``).join(', ')}.`;
}

/** Every route a token can call, with the scopes the policy grants it. */
export async function tokenCallableRoutes(): Promise<
  { expressPath: string; method: string; mount: string; path: string; scopes: string[] }[]
> {
  const discovered = await discoverAuthedRoutes();
  const routes = discovered
    .map((route: DiscoveredRoute) => {
      const scopes = apiTokenScopesForRequest(route.mount, route.method, route.path);
      return {
        expressPath: fullPath(route),
        method: route.method,
        mount: route.mount,
        path: toOpenApiPath(fullPath(route)),
        scopes,
      };
    })
    .filter((route) => route.scopes.length > 0);

  // MCP authenticates personal tokens independently of requireAuth, so it is not in the
  // authenticated-router walk. Use the same policy function and document only its bearer route.
  const mcpScopes = apiTokenScopesForRequest('/v1/mcp', 'POST', '/');
  if (mcpScopes.length > 0) {
    routes.push({ expressPath: '/v1/mcp', method: 'POST', mount: '/v1/mcp', path: '/v1/mcp', scopes: mcpScopes });
  }
  return routes;
}

/** Fail loudly when the catalog and the allowlist disagree, naming the offending route. */
export function assertCatalogMatches(
  routes: { expressPath: string; method: string; }[],
): void {
  const allowed = new Set(routes.map((route) => `${route.method} ${route.expressPath}`));
  const documented = new Set(Object.keys(OPERATIONS));

  const undocumented = [...allowed].filter((key) => !documented.has(key)).sort();
  const unreachable = [...documented].filter((key) => !allowed.has(key)).sort();

  if (undocumented.length > 0) {
    throw new Error(
      `The API-token allowlist reaches routes the public catalog does not document:\n` +
        undocumented.map((key) => `  - ${key}`).join('\n') +
        `\nAdd them to src/openapi/route-catalog.ts.`,
    );
  }
  if (unreachable.length > 0) {
    throw new Error(
      `The public catalog documents routes a token cannot reach:\n` +
        unreachable.map((key) => `  - ${key}`).join('\n') +
        `\nRemove them from src/openapi/route-catalog.ts.`,
    );
  }
}

function operationResponses(definition: OperationDefinition): RouteConfig['responses'] {
  const status = String(definition.status ?? 200);
  const success = definition.noContent
    ? { description: 'Success. The response has no body.' }
    : {
        content: {
          [definition.contentType ?? 'application/json']: {
            schema: definition.response,
          },
        },
        description: 'Successful response.',
      };

  const responses: RouteConfig['responses'] = { [status]: success };
  for (const noContentStatus of definition.noContentStatuses ?? []) {
    responses[String(noContentStatus)] = { description: 'Success. The response has no body.' };
  }
  for (const [code, description] of Object.entries(ERROR_RESPONSES)) {
    responses[code] = {
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      description,
    };
  }
  return responses;
}

/** Sort paths and methods so regenerating the same routes produces the same bytes. */
function sortDocument(document: Record<string, unknown>): Record<string, unknown> {
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  const sortedPaths: Record<string, Record<string, unknown>> = {};
  for (const path of Object.keys(paths).sort()) {
    const item = paths[path]!;
    const sortedItem: Record<string, unknown> = {};
    for (const method of HTTP_METHOD_ORDER) {
      if (item[method]) sortedItem[method] = item[method];
    }
    for (const key of Object.keys(item)) {
      if (!(key in sortedItem)) sortedItem[key] = item[key];
    }
    sortedPaths[path] = sortedItem;
  }
  return { ...document, paths: sortedPaths };
}

/** Build the public document. Throws when the catalog and the allowlist disagree. */
export async function buildPublicSpec(): Promise<PublicSpecResult> {
  const routes = await tokenCallableRoutes();
  assertCatalogMatches(routes);

  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    bearerFormat: 'wm_pat',
    description:
      'A personal API token (`wm_pat_…`) created in Settings → API tokens. Send it as ' +
      '`Authorization: Bearer wm_pat_…`. Tokens are shown once; store them like a password.',
    scheme: 'bearer',
    type: 'http',
  });

  registry.register(
    'ApiError',
    z.object({
      code: z.string().describe('Stable, machine-readable reason, e.g. `unauthorized`.'),
      details: z.record(z.string(), z.string()).optional().describe('Values to word the error with (4xx only).'),
      message: z.string(),
    }),
  );

  for (const route of routes) {
    const definition = OPERATIONS[`${route.method} ${route.expressPath}`];
    if (!definition) continue; // assertCatalogMatches already threw.

    const envelope = envelopeOf(definition.request);
    const request: NonNullable<RouteConfig['request']> = {};
    if (envelope.params) request.params = envelope.params as NonNullable<RouteConfig['request']>['params'];
    if (envelope.query) request.query = envelope.query as NonNullable<RouteConfig['request']>['query'];
    if (envelope.body) {
      request.body = {
        content: { 'application/json': { schema: envelope.body } },
        required: true,
      };
    }

    const description = [scopeSentence(route.scopes), definition.description]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');

    registry.registerPath({
      description,
      method: route.method.toLowerCase() as RouteConfig['method'],
      path: route.path,
      request: Object.keys(request).length > 0 ? (request) : undefined,
      responses: operationResponses(definition),
      security: [{ bearerAuth: [] }],
      summary: definition.summary,
      tags: [definition.tag],
      // Shown by the reference and checked by the coverage test; OpenAPI has no native
      // per-operation scope for an HTTP bearer scheme.
      ...({ 'x-required-scopes': route.scopes } as Record<string, unknown>),
    } satisfies RouteConfig);
  }

  const tags = [...new Set(Object.values(OPERATIONS).map((operation) => operation.tag))]
    .sort()
    .map((name) => ({ description: TAG_DESCRIPTIONS[name], name }));

  const document = new OpenApiGeneratorV31(registry.definitions, { sortComponents: 'alphabetically' }).generateDocument({
    info: {
      description:
        'The WonderMoney REST API, as reachable with a personal API token. Every operation ' +
        'lists the scope it needs; a token only reaches the routes its scopes allow. ' +
        'See the API guide for authentication, rate limits, errors and pagination.',
      title: 'WonderMoney API',
      version: '1.0.0',
    },
    openapi: '3.1.0',
    security: [{ bearerAuth: [] }],
    servers: [
      {
        description: 'Your WonderMoney instance. Replace the default with your own base URL.',
        url: '{baseUrl}',
        variables: {
          baseUrl: {
            default: 'https://api.wonder.money',
            description: 'The origin that serves the API, without a trailing slash.',
          },
        },
      },
    ],
    tags,
  }) as unknown as Record<string, unknown>;

  // A path parameter the validator does not declare (rare, but possible) still has to appear:
  // an OpenAPI path template without a matching parameter is invalid.
  const paths = document['paths'] as Record<string, Record<string, { parameters?: unknown[] }>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHOD_ORDER) {
      const operation = item[method];
      if (!operation) continue;
      const parameters = (operation.parameters ?? []) as { in?: string; name?: string; required?: boolean; schema?: unknown }[];
      const declared = new Set(parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name));
      for (const name of pathParameterNames(path)) {
        if (declared.has(name)) continue;
        parameters.push({
          in: 'path',
          name,
          required: true,
          schema: { type: 'string' },
        });
      }
      if (parameters.length > 0) operation.parameters = parameters;
    }
  }

  return {
    document: sortDocument(document),
    routes: routes.map((route) => ({ method: route.method, path: route.path, scopes: route.scopes })),
  };
}

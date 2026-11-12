import { describe, expect, it } from 'vitest';

import { assertCatalogMatches, buildPublicSpec } from '../build-spec';
import { OPERATIONS } from '../route-catalog';

describe('public API OpenAPI contract', () => {
  it('covers exactly every bearer-token route and no other routes', async () => {
    const { document, routes } = await buildPublicSpec();
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const generated = new Set<string>();

    for (const route of routes) {
      const method = route.method.toLowerCase();
      const operation = paths[route.path]?.[method];
      expect(operation, `${route.method} ${route.path} is missing`).toBeDefined();
      generated.add(`${route.method} ${route.path}`);
      expect(operation?.['x-required-scopes']).toEqual(route.scopes);
      expect(operation?.['security']).toEqual([{ bearerAuth: [] }]);
      expect(operation?.['responses']).toBeDefined();
      const definition = OPERATIONS[`${route.method} ${route.path.replace(/\{([^}]+)\}/g, ':$1')}`];
      const responses = operation?.['responses'] as Record<string, { content?: unknown }>;
      const success = responses['200'] ?? responses['201'] ?? responses['204'];
      expect(Boolean(success)).toBe(true);
      expect(success?.content === undefined).toBe(Boolean(definition?.noContent));
    }

    const expected = new Set(routes.map(({ method, path }) => `${method} ${path}`));
    expect(generated).toEqual(expected);
    expect([...generated].some((key) => key.includes('/v1/calendar'))).toBe(false);
    expect([...generated].some((key) => key.includes('/v1/user'))).toBe(false);
    expect([...generated].some((key) => key.includes('/v1/admin'))).toBe(false);
    expect(routes.find(({ path }) => path === '/v1/mcp')?.scopes).toEqual(['mcp:read', 'mcp:propose']);
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });

  it('rejects catalog entries for forbidden or missing routes in either direction', () => {
    expect(() => { assertCatalogMatches([{ expressPath: '/v1/not-documented', method: 'GET' }]); }).toThrow(/does not document/);
    expect(() => { assertCatalogMatches(Object.keys(OPERATIONS).map((key) => {
      const [method, expressPath] = key.split(' ');
      return { expressPath: expressPath?.replace(/\{([^}]+)\}/g, ':$1') ?? '', method: method ?? '' };
    })); }).not.toThrow();
    const catalogRoutes = Object.keys(OPERATIONS).map((key) => {
      const [method, expressPath] = key.split(' ');
      return { expressPath: expressPath?.replace(/\{([^}]+)\}/g, ':$1') ?? '', method: method ?? '' };
    });
    expect(() => { assertCatalogMatches(catalogRoutes.slice(1)); }).toThrow(/cannot reach/);
  });

  it('publishes concrete request and response schemas, not empty object shells', async () => {
    const { document } = await buildPublicSpec();
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['delete', 'get', 'patch', 'post', 'put'].includes(method)) continue;
        const requestBody = operation['requestBody'] as undefined | { content?: Record<string, { schema?: unknown }> };
        expect(requestBody?.content === undefined || Object.values(requestBody.content).some(({ schema }) => Boolean(schema))).toBe(true);
        const responses = operation['responses'] as Record<string, { content?: Record<string, { schema?: unknown }> }>;
        const success = Object.entries(responses).find(([status]) => status.startsWith('2'))?.[1];
        const schemas = Object.values(success?.content ?? {}).map(({ schema }) => schema);
        expect(schemas.every((schema) => schema !== undefined && JSON.stringify(schema) !== '{"type":"object"}')).toBe(true);
        expect(path).toMatch(/^\//);
      }
    }
  });

  it('documents MCP as JSON-RPC with the dedicated scope', async () => {
    const { document } = await buildPublicSpec();
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const operation = paths['/v1/mcp']?.['post'];
    expect(operation?.['x-required-scopes']).toEqual(['mcp:read', 'mcp:propose']);
    expect(operation?.['description']).toContain('JSON-RPC');
    expect(operation?.['requestBody']).toBeDefined();
  });
});

/**
 * Generate the public OpenAPI document for personal API tokens.
 *
 *   pnpm --filter @wondermoney/api openapi
 *   pnpm --filter @wondermoney/api openapi -- --check
 *
 * The output is committed to `apps/docs/openapi/wondermoney.json` and rendered by the docs site.
 * CI regenerates it and fails when the committed file differs, so a route added to the token
 * allowlist cannot ship without its reference entry.
 *
 * Importing the routers pulls in controllers, and some of those validate their environment at
 * import time (better-auth needs the database settings). The generator never opens a connection,
 * so inert placeholders are enough; they must be set before the dynamic imports below.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, {
  DB_DATABASE: process.env['DB_DATABASE'] ?? 'openapi-generation',
  DB_HOST: process.env['DB_HOST'] ?? 'localhost',
  DB_PASSWORD: process.env['DB_PASSWORD'] ?? 'openapi-generation',
  DB_PORT: process.env['DB_PORT'] ?? '5432',
  DB_USERNAME: process.env['DB_USERNAME'] ?? 'openapi-generation',
  NODE_ENV: process.env['NODE_ENV'] ?? 'test',
});

const { buildPublicSpec } = await import('../src/openapi/build-spec.js');

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, '..', '..', 'docs', 'openapi', 'wondermoney.json');

const { document, routes } = await buildPublicSpec();

mkdirSync(dirname(output), { recursive: true });
const generated = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let committed: string;
  try {
    committed = readFileSync(output, 'utf8');
  } catch {
    throw new Error(`Public OpenAPI document is missing at ${output}; run 'pnpm openapi' and commit it.`);
  }
  if (committed !== generated) {
    throw new Error(`Public OpenAPI document is stale at ${output}; run 'pnpm openapi' and commit the result.`);
  }
  console.log(`Public OpenAPI document is current (${routes.length} token-callable operations).`);
} else {
  writeFileSync(output, generated);
  console.log(`Public OpenAPI document written to ${output} (${routes.length} token-callable operations).`);
}

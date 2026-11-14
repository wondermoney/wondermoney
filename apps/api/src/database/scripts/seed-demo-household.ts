import { pathToFileURL } from 'node:url';

import { RequestContext } from '@mikro-orm/core';

import { closeDatabase, connectDatabase, DI } from '@app/database/di';

/**
 * `pnpm demo:seed` (built `dist`, `NODE_ENV=production`) or `pnpm demo:seed:dev` (source): create or
 * refresh the shared demo account and its household on the database `DB_*` points at. Safe to run
 * again; it writes the demo account and household only (see `demo-household-seed.service.ts`).
 * `--as-of-date YYYY-MM-DD` dates the demo transactions up to that day instead of today.
 */
export async function main(argv = process.argv.slice(2)) {
  const asOfDate = parseAsOfDate(argv);
  const { seedDemoHousehold } = await import('@service/demo-data/demo-household-seed.service');
  const { closeBetterAuthPool } = await import('@service/auth/better-auth');
  await connectDatabase();

  try {
    const result = await RequestContext.create(DI.em, () => seedDemoHousehold({ asOfDate, em: DI.em }));
    console.log('Demo account and household are ready', result);
    return result;
  } finally {
    await closeDatabase();
    await closeBetterAuthPool();
  }
}

export function parseAsOfDate(args: string[]): Date {
  if (args.length === 0) return new Date();
  const [flag, value, ...rest] = args;
  if (flag !== '--as-of-date' || !value || rest.length > 0) {
    throw new Error(`Usage: demo:seed [--as-of-date YYYY-MM-DD]; got ${args.join(' ')}`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (parsed?.toISOString().slice(0, 10) !== value) throw new Error(`Invalid --as-of-date value: ${value}`);
  return parsed;
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedAsScript) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

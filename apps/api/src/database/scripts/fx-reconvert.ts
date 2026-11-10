/**
 * Run the `fx.reconvert` pass by hand: the same code the worker runs after each exchange-rate
 * refresh. Use `--dry-run` first to see how many rows and accounts a run would change; it rolls
 * every account back after working it out.
 */
import { pathToFileURL } from 'node:url';

import { RequestContext } from '@mikro-orm/core';

import { closeDatabase, connectDatabase, DI } from '@app/database/di';

export async function main(argv = process.argv.slice(2)) {
  const dryRun = parseFxReconvertArgs(argv);
  const { reconvertFx } = await import('@service/currency/fx-reconvert.service');
  await connectDatabase();
  try {
    const result = await RequestContext.create(DI.em, () => reconvertFx(DI.em, { dryRun }));
    console.log(dryRun ? 'FX re-conversion (dry run, nothing written)' : 'FX re-conversion', result);
    return result;
  } finally {
    await closeDatabase();
  }
}

function parseFxReconvertArgs(args: string[]): boolean {
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return dryRun;
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedAsScript) {
  void main();
}

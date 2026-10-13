import { pathToFileURL } from 'node:url';

import { RequestContext } from '@mikro-orm/core';

import { closeDatabase, connectDatabase, DI } from '@app/database/di';

export interface DemoRefreshArgs {
  asOfDate: Date;
  dryRun: boolean;
}

export async function main(argv = process.argv.slice(2)) {
  const { asOfDate, dryRun } = parseDemoRefreshArgs(argv);
  const { DemoDataRefreshService } = await import('@service/demo-data/demo-data-refresh.service');
  await connectDatabase();

  try {
    const result = await RequestContext.create(DI.em, async () => {
      const service = new DemoDataRefreshService({ em: DI.em });
      return service.refresh({ asOfDate, dryRun });
    });
    console.log('Demo data refreshed', result);
    return result;
  } finally {
    await closeDatabase();
  }
}

export function parseDemoRefreshArgs(args: string[]): DemoRefreshArgs {
  let dryRun = false;
  let asOfDate = new Date();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--as-of-date') {
      const value = args[index + 1];
      if (!value) throw new Error('Missing value for --as-of-date');
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) throw new Error(`Invalid --as-of-date value: ${value}`);
      const [, year, month, day] = match;
      const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        parsed.getUTCFullYear() !== Number(year) ||
        parsed.getUTCMonth() !== Number(month) - 1 ||
        parsed.getUTCDate() !== Number(day)
      ) {
        throw new Error(`Invalid --as-of-date value: ${value}`);
      }
      asOfDate = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { asOfDate, dryRun };
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedAsScript) {
  void main();
}

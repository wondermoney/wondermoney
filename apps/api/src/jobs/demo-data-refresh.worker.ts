import type { Job } from 'pg-boss';

import { DemoDataRefreshService } from '@service/demo-data/demo-data-refresh.service';

interface DemoDataRefreshDeps {
  demoDataRefreshService?: { refresh: (input?: { asOfDate?: Date; dryRun?: boolean }) => Promise<unknown> };
}

function parseAsOfDate(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid asOfDate value: ${String(value)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid asOfDate value: ${value}`);

  const parsed = new Date(`${value}T00:00:00.000Z`);
  const roundTrip = parsed.toISOString().slice(0, 10);
  if (roundTrip !== value) throw new Error(`Invalid asOfDate value: ${value}`);

  return parsed;
}

export const handleDemoDataRefreshJob = async (
  job: Job<{ asOfDate?: string; correlationId?: string; dryRun?: boolean }>,
  deps: DemoDataRefreshDeps = {},
) => {
  const asOfDate = job.data.asOfDate === undefined ? undefined : parseAsOfDate(job.data.asOfDate);
  const dryRun = job.data.dryRun === true;
  const service = deps.demoDataRefreshService ?? new DemoDataRefreshService();

  return service.refresh({ asOfDate, dryRun });
};

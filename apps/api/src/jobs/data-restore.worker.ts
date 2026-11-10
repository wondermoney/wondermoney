import type { Job } from 'pg-boss';

import { DI } from '@app/database/di';
import { resolveCatalogueAsset } from '@service/data-restore/catalogue-asset';
import { DataRestoreService } from '@service/data-restore/data-restore.service';
import type { Enqueue } from '@service/queue/enqueue';

interface DataRestoreWorkerDeps {
  createService?: () => Pick<DataRestoreService, 'deleteUpload' | 'run'>;
  enqueue: Enqueue;
}

const serviceOf = (deps: DataRestoreWorkerDeps) => deps.createService?.() ?? new DataRestoreService(DI.em, { enqueue: deps.enqueue, restore: { resolveAsset: resolveCatalogueAsset } });

/** Check (a dry run) or run one restore. A failure is recorded on the operation, not retried. */
export const handleDataRestoreJob = async (job: Job<{ correlationId?: unknown; mode?: unknown }>, deps: DataRestoreWorkerDeps) => {
  const { correlationId, mode } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  if (mode !== 'validate' && mode !== 'commit') return false;
  return serviceOf(deps).run(correlationId, job.id, mode);
};

/** Delete an uploaded restore file a day on. Throws on a storage failure so pg-boss retries. */
export const handleDataRestoreCleanupJob = async (job: Job<{ correlationId?: unknown }>, deps: DataRestoreWorkerDeps) => {
  const { correlationId } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  await serviceOf(deps).deleteUpload(correlationId);
  return true;
};

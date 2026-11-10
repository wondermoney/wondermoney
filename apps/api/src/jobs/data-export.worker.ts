import type { Job } from 'pg-boss';

import { DI } from '@app/database/di';
import { DataExportService } from '@service/data-export/data-export.service';
import type { Enqueue } from '@service/queue/enqueue';

interface DataExportWorkerDeps {
  createService?: () => Pick<DataExportService, 'deleteStoredExport' | 'runStoredExport'>;
  enqueue: Enqueue;
}

const serviceOf = (deps: DataExportWorkerDeps) => deps.createService?.() ?? new DataExportService(DI.em, { enqueue: deps.enqueue });

/** Build, store and announce one export. A failure is recorded on the operation, not retried. */
export const handleDataExportJob = async (job: Job<{ correlationId?: unknown }>, deps: DataExportWorkerDeps) => {
  const { correlationId } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  return serviceOf(deps).runStoredExport(correlationId, job.id);
};

/** Delete a stored export once its 24 hours are up. Throws on a storage failure so pg-boss retries. */
export const handleDataExportCleanupJob = async (job: Job<{ correlationId?: unknown }>, deps: DataExportWorkerDeps) => {
  const { correlationId } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  await serviceOf(deps).deleteStoredExport(correlationId);
  return true;
};

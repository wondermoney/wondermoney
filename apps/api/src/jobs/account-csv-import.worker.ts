import type { Job } from 'pg-boss';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import AccountCsvImportService from '@service/account/account-csv-import.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';

interface WorkerDeps {
  backgroundOperationService?: { claimJobStart: (correlationId: string, queueJobId: string) => Promise<boolean>; finishJob: (correlationId: string, queueJobId: string, input: { retryable?: boolean; stage?: string; status: BackgroundOperationStatus }) => Promise<boolean>; heartbeatJob: (correlationId: string, queueJobId: string, input: { progress?: Record<string, unknown>; stage?: string }) => Promise<boolean> };
  enqueue?: Enqueue;
  importService?: Pick<AccountCsvImportService, 'importAccountCsv'>;
}

export const handleAccountCsvImportJob = async (job: Job<{ accountKey?: number; bankName?: string; bucket?: string; correlationId?: string; key?: string; }>, deps: WorkerDeps = {}) => {
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const svc = deps.importService ?? new AccountCsvImportService();
  const { accountKey, bankName, bucket, correlationId, key } = job.data;
  if (!accountKey || !bucket || !correlationId || !key) return false;
  if (!(await bg.claimJobStart(correlationId, job.id))) return false;

  try {
    const result = await svc.importAccountCsv({ accountKey, bankName, bucket, key }, { enqueue: deps.enqueue });
    const stage = 'account.csv-import:complete';
    if (!(await bg.heartbeatJob(correlationId, job.id, { progress: result as unknown as Record<string, unknown>, stage }))) throw new Error('account.csv-import job failed heartbeat');
    const status = result.failed > 0 ? (result.imported > 0 || result.skipped > 0 ? BackgroundOperationStatus.PARTIAL : BackgroundOperationStatus.FAILED) : BackgroundOperationStatus.SUCCEEDED;
    const finished = await bg.finishJob(correlationId, job.id, { retryable: status !== BackgroundOperationStatus.SUCCEEDED, stage, status });
    if (!finished) throw new Error('account.csv-import job failed to finish');
    return true;
  } catch (error) {
    const finished = await bg.finishJob(correlationId, job.id, { retryable: true, stage: 'account.csv-import:failed', status: BackgroundOperationStatus.FAILED });
    if (!finished) throw new Error('account.csv-import job failed to finish');
    throw error;
  }
};

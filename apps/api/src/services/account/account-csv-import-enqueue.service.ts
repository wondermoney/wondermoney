import { DI } from '@app/database/di';
import { enqueueAccountCsvImportJob } from '@app/jobs/account-csv-import.queue';
import { Account } from '@entity/Account';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';

const OPERATION_TYPE = 'account.csv-import';

class AccountCsvImportQueueError extends Error { constructor(message: string, public readonly queueAccepted: boolean) { super(message); } }

export default class AccountCsvImportEnqueueService {
  async enqueue(input: { accountKey: number; bankName?: string; bucket: string; correlationId?: string; key: string; }, deps: { backgroundOperationService?: { attachQueueJob: (correlationId: string, queueJobId: string) => Promise<boolean>; createQueuedOperation: (input: Record<string, unknown>) => Promise<{ appuserKey?: unknown; correlationId: string; retryable?: boolean; tenantKey?: unknown }>; markNeedsAction: (correlationId: string, errorCode: string, stage?: string) => Promise<unknown> }; em?: { findOne: typeof DI.em.findOne; persist: (entity: unknown) => { flush(): Promise<void> }; }; enqueue: Enqueue; }) {
    const bg = deps.backgroundOperationService ?? backgroundOperationService;
    const em = deps.em ?? DI.em;
    const correlationId = input.correlationId ?? `account.csv-import:${input.accountKey}:${input.key.replace(/[^\w.-]/g, '_')}`;
    const resourceId = `account-csv-import:${input.accountKey}:${encodeURIComponent(input.bankName ?? '')}:${input.bucket}:${input.key}`;
    const account = await em.findOne(Account, { accountKey: input.accountKey, deletedAt: undefined }, { populate: ['accountOwnerAppuserKey', 'tenantKey'] });
    if (!account) throw new Error('Account not found');
    const operation = await bg.createQueuedOperation({ appuserKey: null, correlationId, operationType: OPERATION_TYPE, resourceId, retryable: true, tenantKey: null });
    operation.retryable = true; operation.appuserKey = account.accountOwnerAppuserKey; operation.tenantKey = account.tenantKey; await em.persist(operation).flush();
    try {
      const jobId = await enqueueAccountCsvImportJob({ accountKey: input.accountKey, bankName: input.bankName, bucket: input.bucket, correlationId, key: input.key }, { enqueue: deps.enqueue });
      if (!jobId) { await bg.markNeedsAction(correlationId, 'account.csv-import:enqueue-null', 'account.csv-import:queueing'); throw new AccountCsvImportQueueError('Account csv import queue returned no job id', false); }
      const attached = await bg.attachQueueJob(correlationId, String(jobId));
      if (!attached) { await bg.markNeedsAction(correlationId, 'account.csv-import:attach-false', 'account.csv-import:queueing'); throw new AccountCsvImportQueueError('Account csv import job accepted but could not be attached', true); }
      return operation;
    } catch (error) {
      if (error instanceof AccountCsvImportQueueError) throw error;
      await bg.markNeedsAction(correlationId, 'account.csv-import:enqueue-failed', 'account.csv-import:queueing');
      throw new AccountCsvImportQueueError('Account csv import queue failed before acceptance', false);
    }
  }
}

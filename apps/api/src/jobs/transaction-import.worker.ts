import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import type { Enqueue } from '@service/queue/enqueue';
import { sweepExpiredTransactionImportSessions, type TransactionImportSweepStorage } from '@service/transaction-import/transaction-import-sweep';
import { TransactionImportService } from '@service/transaction-import/transaction-import.service';
import logger from '@utils/logger';

interface TransactionImportWorkerDeps {
  createService?: () => Pick<TransactionImportService, 'run'>;
  enqueue: Enqueue;
}

/** Parse a staged import's file, or commit its rows. A malformed payload is dropped. */
export const handleTransactionImportJob = async (job: Job<{ correlationId?: unknown; mode?: unknown }>, deps: TransactionImportWorkerDeps) => {
  const { correlationId, mode } = job.data;
  if (typeof correlationId !== 'string' || correlationId.length === 0) return false;
  if (mode !== 'parse' && mode !== 'commit') return false;
  const service = deps.createService?.() ?? new TransactionImportService(DI.em, { enqueue: deps.enqueue });
  return service.run(correlationId, job.id, mode);
};

/** The daily sweep of expired, uncommitted imports in every household. */
export const handleTransactionImportSweepJob = async (deps: { em?: EntityManager; logger?: Pick<Logger, 'info' | 'warn'>; now?: Date; storage?: TransactionImportSweepStorage } = {}) => {
  const result = await sweepExpiredTransactionImportSessions({ em: deps.em ?? DI.em, now: deps.now ?? new Date(), storage: deps.storage });
  const log = deps.logger ?? logger;
  log.info({ ...result, queue: 'transaction-import.sweep' }, 'Expired import sweep finished');
  if (result.fileErrors > 0) log.warn({ fileErrors: result.fileErrors, queue: 'transaction-import.sweep' }, 'Expired import sweep could not remove some uploaded files');
  return result;
};

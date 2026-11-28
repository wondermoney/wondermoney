import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { PRIVACY_RETENTION_QUEUE } from '@app/jobs/privacy-retention.queue';
import { runRetentionPurge } from '@service/privacy/retention-purge.service';
import type { RetentionStorage } from '@service/privacy/retention-storage';
import logger from '@utils/logger';

interface PrivacyRetentionDeps {
  em?: EntityManager;
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  storage?: RetentionStorage;
}

/**
 * Deletes the personal data whose retention period is over (`runRetentionPurge`), in every
 * household. Logs counts only. A step that failed fails the job once the others have run, so
 * pg-boss retries it; what the other steps deleted stays deleted, and a retry finds nothing more
 * for them.
 */
export const handlePrivacyRetentionJob = async (job: Job<Record<string, never>>, deps: PrivacyRetentionDeps = {}) => {
  const log = deps.logger ?? logger;
  const result = await runRetentionPurge({ em: deps.em ?? DI.em, logger: log, now: deps.now?.() ?? new Date(), storage: deps.storage });
  log.info({ jobId: job.id, ...result, queue: PRIVACY_RETENTION_QUEUE }, 'Retention purge finished');
  if (result.failed.length > 0) throw new Error(`Retention purge failed for: ${result.failed.join(', ')}`);
  return result;
};

import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { expireProposals } from '@service/assistant-proposal/assistant-proposal.service';
import logger from '@utils/logger';

interface AssistantProposalExpiryDeps {
  em?: EntityManager;
  logger?: Pick<Logger, 'info'>;
  now?: () => Date;
}

/**
 * Mark every pending assistant proposal past its seven days as `expired`, in every household (the
 * worker EM has no tenant context). One UPDATE, so a retry after a failure simply runs it again.
 */
export const handleAssistantProposalExpiryJob = async (
  job: Job<Record<string, never>>,
  deps: AssistantProposalExpiryDeps = {},
) => {
  const em = deps.em ?? DI.em;
  const now = deps.now?.() ?? new Date();
  const expired = await expireProposals(em, now);
  (deps.logger ?? logger).info({ expired, jobId: job.id, queue: 'assistant-proposal.expiry' }, 'Assistant proposal expiry finished');
  return { expired };
};

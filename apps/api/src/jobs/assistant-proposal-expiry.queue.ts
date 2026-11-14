export const ASSISTANT_PROPOSAL_EXPIRY_QUEUE = 'assistant-proposal.expiry';

/**
 * Hourly: a proposal lapses within the hour after its seven days. The list already leaves a
 * past-due proposal out of `pending` and apply refuses it, so this only makes the stored status say so.
 */
export const ASSISTANT_PROPOSAL_EXPIRY_CRON = '17 * * * *';

export const ensureAssistantProposalExpiryQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) => boss.createQueue(ASSISTANT_PROPOSAL_EXPIRY_QUEUE, {
  expireInSeconds: 600,
  policy: 'exclusive',
  retryBackoff: true,
  retryDelay: 300,
  retryLimit: 3,
});

export const scheduleAssistantProposalExpiryJob = (boss: {
  schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}) =>
  boss.schedule(ASSISTANT_PROPOSAL_EXPIRY_QUEUE, ASSISTANT_PROPOSAL_EXPIRY_CRON, {}, {
    key: ASSISTANT_PROPOSAL_EXPIRY_QUEUE,
    singletonKey: ASSISTANT_PROPOSAL_EXPIRY_QUEUE,
    tz: 'UTC',
  });

export const MCP_OAUTH_CLIENT_PRUNE_QUEUE = 'mcp-oauth.client-prune';

/** Daily at 04:40 UTC, a quiet hour: removes the OAuth clients that went unused for seven days. */
export const MCP_OAUTH_CLIENT_PRUNE_CRON = '40 4 * * *';

export const ensureMcpOAuthClientPruneQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) => boss.createQueue(MCP_OAUTH_CLIENT_PRUNE_QUEUE, {
  expireInSeconds: 1_800,
  policy: 'exclusive',
  retryBackoff: true,
  retryDelay: 600,
  retryLimit: 3,
});

/**
 * Registered whatever `MCP_OAUTH_ENABLED` says: the handler does nothing while it is off, so the
 * schedule needs no unschedule step when an operator turns the switch on or off between deploys.
 */
export const scheduleMcpOAuthClientPruneJob = (boss: {
  schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}) =>
  boss.schedule(MCP_OAUTH_CLIENT_PRUNE_QUEUE, MCP_OAUTH_CLIENT_PRUNE_CRON, {}, {
    key: MCP_OAUTH_CLIENT_PRUNE_QUEUE,
    singletonKey: MCP_OAUTH_CLIENT_PRUNE_QUEUE,
    tz: 'UTC',
  });

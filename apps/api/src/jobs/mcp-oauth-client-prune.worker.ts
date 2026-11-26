import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { MCP_OAUTH_CLIENT_PRUNE_QUEUE } from '@app/jobs/mcp-oauth-client-prune.queue';
import { pruneUnusedMcpOAuthClients } from '@service/mcp/mcp-oauth-client-prune.service';
import { isMcpOAuthEnabled } from '@service/mcp/mcp-oauth-config';
import logger from '@utils/logger';

interface McpOAuthClientPruneDeps {
  em?: EntityManager;
  /** Whether OAuth for the MCP server is on (`mcpOAuthResourceIfEnabled`, the switch every OAuth surface reads). */
  isEnabled?: () => boolean;
  /** The most clients one run handles (`MCP_OAUTH_CLIENT_PRUNE_LIMIT`). */
  limit?: number;
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
}

/**
 * Remove the OAuth clients that registered for the MCP server and went unused for seven days
 * (`pruneUnusedMcpOAuthClients`). Does nothing while OAuth for the MCP server is off: nothing can
 * register then, and a client left from before stays until the switch is on again, as do the
 * grants Settings still lists. Logs counts only, never a client's name or redirects (both are
 * whatever an unauthenticated registration sent). A run takes at most `limit` clients and logs
 * when more are left, for the next day's run. A client that could not be removed fails the job,
 * so pg-boss retries it; the ones already removed stay removed.
 */
export const handleMcpOAuthClientPruneJob = async (job: Job<Record<string, never>>, deps: McpOAuthClientPruneDeps = {}) => {
  const log = deps.logger ?? logger;
  const enabled = deps.isEnabled ?? (() => isMcpOAuthEnabled());
  if (!enabled()) {
    log.info({ jobId: job.id, queue: MCP_OAUTH_CLIENT_PRUNE_QUEUE }, 'MCP OAuth client prune skipped: OAuth for the MCP server is off');
    return { pruned: 0, skipped: true };
  }

  const em = deps.em ?? DI.em;
  const now = deps.now?.() ?? new Date();
  const result = await pruneUnusedMcpOAuthClients(em, now, {
    limit: deps.limit,
    onError: (error) => {
      log.warn({ error, jobId: job.id, queue: MCP_OAUTH_CLIENT_PRUNE_QUEUE }, 'MCP OAuth client prune failed for a client');
    },
  });
  log.info({ jobId: job.id, ...result, queue: MCP_OAUTH_CLIENT_PRUNE_QUEUE }, 'MCP OAuth client prune finished');
  if (result.more) {
    log.info({ jobId: job.id, queue: MCP_OAUTH_CLIENT_PRUNE_QUEUE }, 'MCP OAuth client prune stopped at its per-run limit: the next run removes the rest');
  }
  if (result.failed > 0) throw new Error(`MCP OAuth client prune failed for ${result.failed} clients`);
  return { ...result, skipped: false };
};

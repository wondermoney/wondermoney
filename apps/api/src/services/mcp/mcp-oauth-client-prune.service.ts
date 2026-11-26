import type { EntityManager } from '@mikro-orm/postgresql';

/** How long a registered OAuth client may go without a grant before it is removed. */
export const MCP_OAUTH_UNUSED_CLIENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The most clients one run removes: after a registration flood, the next runs take the rest. */
export const MCP_OAUTH_CLIENT_PRUNE_LIMIT = 1_000;

export interface McpOAuthClientPruneOptions {
  /** The most clients this run handles, those unused longest first. */
  limit?: number;
  onError?: (error: unknown) => void;
}

export interface McpOAuthClientPruneResult {
  /** Clients that could not be removed (the job reports and retries them). */
  failed: number;
  /** Clients already gone when their turn came: removed meanwhile by another run. */
  gone: number;
  /** Clients that gained a grant between the scan and their removal, and so were kept. */
  kept: number;
  /** Whether more unused clients were left than this run takes (`limit`): the next run goes on. */
  more: boolean;
  pruned: number;
}

/**
 * The time from which a client counts as unused: its registration, or when it lost its last grant
 * if that came later (`better_auth."mcpOAuthClientActivity"`, set by `revokeMcpOAuthGrant` and
 * `revokeAllMcpOAuthGrants`). Needs `activity` joined to `client`.
 */
const UNUSED_SINCE = `greatest(client."createdAt", activity."lastGrantEndedAt")`;

/**
 * A client is unused when it was registered before `?` (the cutoff), lost its last grant before it
 * too, and holds no grant: no consent (revoking in Settings deletes it) and no refresh token that
 * is neither revoked nor expired. A registration with no creation time is kept.
 */
const UNUSED_CLIENT = `client."createdAt" < ?
   and (activity."lastGrantEndedAt" is null or activity."lastGrantEndedAt" < ?)
   and not exists (select 1 from better_auth."oauthConsent" consent where consent."clientId" = client."clientId")
   and not exists (
     select 1 from better_auth."oauthRefreshToken" refresh
      where refresh."clientId" = client."clientId" and refresh.revoked is null and refresh."expiresAt" > ?
   )`;

const CLIENTS = `better_auth."oauthClient" client
  left join better_auth."mcpOAuthClientActivity" activity on activity."clientId" = client."clientId"`;

/** The rows that belong to one client, removed before the client itself. */
const CLIENT_ROWS = ['oauthAccessToken', 'oauthRefreshToken', 'oauthConsent', 'oauthClientResource', 'mcpOAuthClientActivity'] as const;

/**
 * Remove the OAuth clients registered for the MCP server (`services/auth/mcp-oauth.ts`) that
 * have gone unused: with no consent and no live refresh token, registered more than seven days
 * before `now` and, when every grant on them was revoked, revoked more than seven days before it
 * too. Their access tokens, refresh tokens and resource links go with them. Dynamic registration
 * is open to anyone, so without this the table only grows. A client that someone uses is never
 * touched, and a client someone stopped using goes seven days after its last grant did.
 *
 * One run handles at most `limit` clients (`MCP_OAUTH_CLIENT_PRUNE_LIMIT`), those unused
 * longest first, so a run after a registration flood ends well within the job's timeout;
 * `more` says the next run has more to do.
 *
 * Instance-wide by design: OAuth clients belong to no household, and nothing here reads or
 * returns a person's data. Each client goes in its own transaction, which locks the client row
 * and then checks again, in a fresh statement, that it is still unused: a consent stored for it
 * meanwhile either commits first (and the client is kept) or waits on the lock and then fails
 * its foreign key. The consent hook (`mcpOAuthPolicy`) waits on the same lock and answers
 * `invalid_client` before better-auth tries to store one.
 */
export async function pruneUnusedMcpOAuthClients(
  em: EntityManager,
  now: Date,
  options: McpOAuthClientPruneOptions = {},
): Promise<McpOAuthClientPruneResult> {
  const limit = options.limit ?? MCP_OAUTH_CLIENT_PRUNE_LIMIT;
  const onError = options.onError ?? (() => undefined);
  const cutoff = new Date(now.getTime() - MCP_OAUTH_UNUSED_CLIENT_AGE_MS);
  const found = await em.getConnection().execute<{ clientId: string }[]>(
    `select client."clientId" from ${CLIENTS} where ${UNUSED_CLIENT} order by ${UNUSED_SINCE}, client."clientId" limit ?`,
    [cutoff, cutoff, now, limit + 1],
  );
  const candidates = found.slice(0, limit);

  const result: McpOAuthClientPruneResult = { failed: 0, gone: 0, kept: 0, more: found.length > limit, pruned: 0 };
  for (const { clientId } of candidates) {
    try {
      const outcome = await em.fork().transactional(async (tx): Promise<'gone' | 'kept' | 'pruned'> => {
        const connection = tx.getConnection();
        const context = tx.getTransactionContext();
        const [locked] = await connection.execute<{ clientId: string }[]>(
          'select "clientId" from better_auth."oauthClient" where "clientId" = ? for update',
          [clientId],
          'all',
          context,
        );
        if (!locked) return 'gone';
        const [stillUnused] = await connection.execute<{ clientId: string }[]>(
          `select client."clientId" from ${CLIENTS} where client."clientId" = ? and ${UNUSED_CLIENT}`,
          [clientId, cutoff, cutoff, now],
          'all',
          context,
        );
        if (!stillUnused) return 'kept';
        for (const table of CLIENT_ROWS) {
          await connection.execute(`delete from better_auth."${table}" where "clientId" = ?`, [clientId], 'run', context);
        }
        await connection.execute('delete from better_auth."oauthClient" where "clientId" = ?', [clientId], 'run', context);
        return 'pruned';
      });
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      onError(error);
    }
  }
  return result;
}

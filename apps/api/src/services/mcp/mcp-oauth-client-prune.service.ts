import type { EntityManager } from '@mikro-orm/postgresql';

/** How long a registered OAuth client may go without a grant before it is removed. */
export const MCP_OAUTH_UNUSED_CLIENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface McpOAuthClientPruneResult {
  /** Clients that could not be removed (the job reports and retries them). */
  failed: number;
  /** Clients that gained a grant between the scan and their removal, and so were kept. */
  kept: number;
  pruned: number;
}

/**
 * A client is unused when it was registered before `?` (the cutoff) and holds no grant: no
 * consent (revoking in Settings deletes it) and no refresh token that is neither revoked nor
 * expired. A client whose every grant was revoked is unused from then on. A registration with no
 * creation time is kept.
 */
const UNUSED_CLIENT = `client."createdAt" < ?
   and not exists (select 1 from better_auth."oauthConsent" consent where consent."clientId" = client."clientId")
   and not exists (
     select 1 from better_auth."oauthRefreshToken" refresh
      where refresh."clientId" = client."clientId" and refresh.revoked is null and refresh."expiresAt" > ?
   )`;

/** The rows that belong to one client, removed before the client itself. */
const CLIENT_ROWS = ['oauthAccessToken', 'oauthRefreshToken', 'oauthConsent', 'oauthClientResource'] as const;

/**
 * Remove the OAuth clients registered for the MCP server (`services/auth/mcp-oauth.ts`) that
 * have gone unused: registered more than seven days before `now`, with no consent and no live
 * refresh token, together with their access tokens, refresh tokens and resource links. Dynamic
 * registration is open to anyone, so without this the table only grows. A client that someone
 * uses is never touched, and a client someone stopped using goes once its grant is gone.
 *
 * Instance-wide by design: OAuth clients belong to no household, and nothing here reads or
 * returns a person's data. Each client goes in its own transaction, which locks the client row
 * and then checks again, in a fresh statement, that it is still unused: a consent stored for it
 * meanwhile either commits first (and the client is kept) or waits on the lock and then fails
 * its foreign key, as an authorization on a client this old would on a removed client anyway.
 */
export async function pruneUnusedMcpOAuthClients(
  em: EntityManager,
  now: Date,
  onError: (error: unknown) => void = () => undefined,
): Promise<McpOAuthClientPruneResult> {
  const cutoff = new Date(now.getTime() - MCP_OAUTH_UNUSED_CLIENT_AGE_MS);
  const candidates = await em.getConnection().execute<{ clientId: string }[]>(
    `select client."clientId" from better_auth."oauthClient" client where ${UNUSED_CLIENT} order by client."createdAt", client."clientId"`,
    [cutoff, now],
  );

  const result: McpOAuthClientPruneResult = { failed: 0, kept: 0, pruned: 0 };
  for (const { clientId } of candidates) {
    try {
      const pruned = await em.fork().transactional(async (tx) => {
        const connection = tx.getConnection();
        const context = tx.getTransactionContext();
        await connection.execute('select 1 from better_auth."oauthClient" where "clientId" = ? for update', [clientId], 'all', context);
        const [stillUnused] = await connection.execute<{ clientId: string }[]>(
          `select client."clientId" from better_auth."oauthClient" client where client."clientId" = ? and ${UNUSED_CLIENT}`,
          [clientId, cutoff, now],
          'all',
          context,
        );
        if (!stillUnused) return false;
        for (const table of CLIENT_ROWS) {
          await connection.execute(`delete from better_auth."${table}" where "clientId" = ?`, [clientId], 'run', context);
        }
        await connection.execute('delete from better_auth."oauthClient" where "clientId" = ?', [clientId], 'run', context);
        return true;
      });
      if (pruned) result.pruned += 1;
      else result.kept += 1;
    } catch (error) {
      result.failed += 1;
      onError(error);
    }
  }
  return result;
}

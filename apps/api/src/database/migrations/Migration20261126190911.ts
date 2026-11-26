import { Migration } from '@mikro-orm/migrations';

/**
 * When an OAuth client for the MCP server lost its last grant (`services/mcp/mcp-oauth-client-prune.service.ts`).
 *
 * A side table beside better-auth's `oauthClient` rather than a column on it: better-auth owns
 * that table's shape, and a row here goes with its client. `lastGrantEndedAt` is set when a
 * revocation leaves the client with no consent and cleared when someone consents again; the
 * daily prune counts its seven days from the later of the registration and this time.
 */
export class Migration20261126190911 extends Migration {

  override name = 'Migration20261126190911';

  override up(): void | Promise<void> {
    this.addSql(`create table better_auth."mcpOAuthClientActivity" ("clientId" text not null primary key references better_auth."oauthClient" ("clientId") on delete cascade, "lastGrantEndedAt" timestamptz null);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists better_auth."mcpOAuthClientActivity";`);
  }

}

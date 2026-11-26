import { Migration } from '@mikro-orm/migrations';

/**
 * OAuth for the MCP server (`services/auth/mcp-oauth.ts`).
 *
 * The tables of better-auth's OAuth provider (`@better-auth/oauth-provider`, which `@better-auth/mcp`
 * configures for MCP clients), in the `better_auth` schema beside its other tables. They have no
 * MikroORM entities, so they are hand-written here, as better-auth's own migration compiler
 * prints them for 1.7.22. They are created whether or not `MCP_OAUTH_ENABLED` is set, so turning
 * the switch on later needs no migration.
 *
 * `assistant_audit_log.oauth_client_id` records the OAuth client an MCP call came through, beside
 * `api_token_key` for a personal API token.
 */
export class Migration20261126100201 extends Migration {

  override name = 'Migration20261126100201';

  override up(): void | Promise<void> {
    this.addSql(`alter table "assistant_audit_log" add "oauth_client_id" varchar(255) null;`);

    this.addSql(`create table better_auth."oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" boolean, "skipConsent" boolean, "enableEndSession" boolean, "subjectType" text, "scopes" jsonb, "clientCredentialsScopes" jsonb, "userId" text references better_auth."user" ("id") on delete cascade, "createdAt" timestamptz, "updatedAt" timestamptz, "name" text, "uri" text, "icon" text, "contacts" jsonb, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" jsonb not null, "postLogoutRedirectUris" jsonb, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" boolean, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" jsonb, "responseTypes" jsonb, "requirePKCE" boolean, "dpopBoundAccessTokens" boolean, "referenceId" text, "metadata" jsonb);`);
    this.addSql(`create table better_auth."oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" jsonb, "customClaims" jsonb, "dpopBoundAccessTokensRequired" boolean, "disabled" boolean, "createdAt" timestamptz, "updatedAt" timestamptz, "policyVersion" integer, "metadata" jsonb);`);
    this.addSql(`create table better_auth."oauthClientResource" ("id" text not null primary key, "clientId" text not null references better_auth."oauthClient" ("clientId") on delete cascade, "resourceId" text not null references better_auth."oauthResource" ("identifier") on delete cascade, "metadata" jsonb, "createdAt" timestamptz);`);
    this.addSql(`create table better_auth."oauthRefreshToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references better_auth."oauthClient" ("clientId") on delete cascade, "sessionId" text references better_auth."session" ("id") on delete set null, "userId" text not null references better_auth."user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" jsonb, "requestedUserInfoClaims" jsonb, "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "revoked" timestamptz, "rotatedAt" timestamptz, "rotationReplayResponse" text, "rotationReplayExpiresAt" timestamptz, "authTime" timestamptz, "confirmation" jsonb, "scopes" jsonb not null);`);
    this.addSql(`create table better_auth."oauthAccessToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references better_auth."oauthClient" ("clientId") on delete cascade, "sessionId" text references better_auth."session" ("id") on delete set null, "userId" text references better_auth."user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" jsonb, "requestedUserInfoClaims" jsonb, "refreshId" text references better_auth."oauthRefreshToken" ("id") on delete cascade, "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "revoked" timestamptz, "confirmation" jsonb, "scopes" jsonb not null);`);
    this.addSql(`create table better_auth."oauthConsent" ("id" text not null primary key, "clientId" text not null references better_auth."oauthClient" ("clientId") on delete cascade, "userId" text references better_auth."user" ("id") on delete cascade, "referenceId" text, "resources" jsonb, "requestedUserInfoClaims" jsonb, "scopes" jsonb not null, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);`);
    this.addSql(`create table better_auth."oauthClientAssertion" ("id" text not null primary key, "expiresAt" timestamptz not null);`);

    this.addSql(`create index "oauthClient_userId_idx" on better_auth."oauthClient" ("userId");`);
    this.addSql(`create index "oauthClientResource_clientId_idx" on better_auth."oauthClientResource" ("clientId");`);
    this.addSql(`create index "oauthClientResource_resourceId_idx" on better_auth."oauthClientResource" ("resourceId");`);
    this.addSql(`create unique index "oauthClientResource_clientId_resourceId_uidx" on better_auth."oauthClientResource" ("clientId", "resourceId");`);
    this.addSql(`create index "oauthRefreshToken_clientId_idx" on better_auth."oauthRefreshToken" ("clientId");`);
    this.addSql(`create index "oauthRefreshToken_sessionId_idx" on better_auth."oauthRefreshToken" ("sessionId");`);
    this.addSql(`create index "oauthRefreshToken_userId_idx" on better_auth."oauthRefreshToken" ("userId");`);
    this.addSql(`create index "oauthRefreshToken_authorizationCodeId_idx" on better_auth."oauthRefreshToken" ("authorizationCodeId");`);
    this.addSql(`create index "oauthAccessToken_clientId_idx" on better_auth."oauthAccessToken" ("clientId");`);
    this.addSql(`create index "oauthAccessToken_sessionId_idx" on better_auth."oauthAccessToken" ("sessionId");`);
    this.addSql(`create index "oauthAccessToken_userId_idx" on better_auth."oauthAccessToken" ("userId");`);
    this.addSql(`create index "oauthAccessToken_authorizationCodeId_idx" on better_auth."oauthAccessToken" ("authorizationCodeId");`);
    this.addSql(`create index "oauthAccessToken_refreshId_idx" on better_auth."oauthAccessToken" ("refreshId");`);
    this.addSql(`create index "oauthConsent_clientId_idx" on better_auth."oauthConsent" ("clientId");`);
    this.addSql(`create index "oauthConsent_userId_idx" on better_auth."oauthConsent" ("userId");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists better_auth."oauthClientAssertion";`);
    this.addSql(`drop table if exists better_auth."oauthConsent";`);
    this.addSql(`drop table if exists better_auth."oauthAccessToken";`);
    this.addSql(`drop table if exists better_auth."oauthRefreshToken";`);
    this.addSql(`drop table if exists better_auth."oauthClientResource";`);
    this.addSql(`drop table if exists better_auth."oauthResource";`);
    this.addSql(`drop table if exists better_auth."oauthClient";`);
    this.addSql(`alter table "assistant_audit_log" drop column "oauth_client_id";`);
  }

}

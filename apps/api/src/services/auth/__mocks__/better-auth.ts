import type { Request, Response } from 'express';
import { type Mock, vi } from 'vitest';

import type { AuthContext, AuthedSession, AuthedUser } from '../better-auth';

/**
 * Shared test double for `@service/auth/better-auth`.
 *
 * The real module fails fast at import when `BETTER_AUTH_SECRET` / the `DB_*` env is
 * absent (by design for prod/staging), builds a live pg `Pool`, and pulls in
 * `@service/email`. None of that is available or wanted in the unit-test harness, so any
 * test that (even transitively) imports the app, server, or worker would crash at
 * import. This inert double stands in for the whole public surface with no side effects.
 *
 * Registered globally by `src/test/setup.ts`. Individual tests may still override it with
 * their own `vi.mock`, and the module's own unit test opts back into the real
 * implementation via `vi.unmock`.
 */

export type { AuthContext, AuthedSession, AuthedUser };

// Any `/api/auth/*` request "succeeds" with 200, so tests exercising routing or rate
// limiting around the auth handler can tell a request that reached the handler (200)
// apart from one the limiter rejected (429).
export const authHandler = vi.fn((_req: Request, res: Response) => res.status(200).json({ auth: true }));

export const BETTER_AUTH_SCHEMA = 'better_auth';

export const betterAuthPool: { end: Mock<() => Promise<void>>; query: Mock<(...args: unknown[]) => Promise<{ rows: unknown[] }>> } = {
  end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  query: vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>().mockResolvedValue({ rows: [] }),
};

export const closeBetterAuthPool = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

export const createBetterAuthUser = vi
  .fn<(input: { email: string; name?: string; password: string }) => Promise<{ id: string }>>()
  .mockResolvedValue({ id: 'test-better-auth-user-id' });

export const createPairedSession = vi
  .fn<(input: { ipAddress?: null | string; userAgent?: null | string; userId: string; }) => Promise<{
    cookieName: string;
    cookieValue: string;
    expiresAt: Date;
    sessionId: string;
    token: string;
  }>>()
  .mockResolvedValue({
    cookieName: 'better-auth.session_token',
    cookieValue: 'paired-token.signature',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    sessionId: 'paired-session-id',
    token: 'paired-token',
  });

export const createDemoSession = vi
  .fn<(input: { expiresAt: Date; userId: string }) => Promise<{
    cookieAttributes: { domain?: string; httpOnly: boolean; path: string; sameSite?: 'lax' | 'none' | 'strict'; secure: boolean };
    cookieName: string;
    cookieValue: string;
    expiresAt: Date;
    sessionId: string;
    token: string;
  }>>()
  .mockImplementation((input) => Promise.resolve({
    cookieAttributes: { httpOnly: true, path: '/', sameSite: 'lax', secure: false },
    cookieName: 'better-auth.session_token',
    cookieValue: 'demo-token.signature',
    expiresAt: input.expiresAt,
    sessionId: 'demo-session-id',
    token: 'demo-token',
  }));

export const ensureDemoAuthUser = vi
  .fn<(input: { email: string; name: string }) => Promise<{ created: boolean; id: string }>>()
  .mockResolvedValue({ created: true, id: 'demo-better-auth-user-id' });

export const findBetterAuthUser = vi
  .fn<(userId: string) => Promise<null | { email: string; id: string; twoFactorEnabled: boolean | null }>>()
  .mockResolvedValue(null);

export const deleteExpiredAuthSessions = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined);

export const listAuthSessions = vi
  .fn<(sessionIds: string[]) => Promise<{
    createdAt: Date;
    expiresAt: Date;
    id: string;
    ipAddress?: null | string;
    updatedAt: Date;
    userAgent?: null | string;
  }[]>>()
  .mockResolvedValue([]);

export const deleteAuthSession = vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined);

export const deleteBetterAuthUser = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined);

export const deleteBetterAuthUserByEmail = vi.fn<(email: string) => Promise<void>>().mockResolvedValue(undefined);

export const getAuthSession = vi.fn<(headers: unknown) => Promise<AuthContext | null>>().mockResolvedValue(null);

export const getPrimaryAuthProvider = vi.fn<(userId: string) => Promise<string>>().mockResolvedValue('email');

export const hashPasswordShim = vi.fn<(password: string) => Promise<string>>().mockResolvedValue('hashed-password');

export const isLegacyBcryptHash = vi.fn((hash: string) => hash.startsWith('$2'));

export const verifyPasswordShim = vi
  .fn<(input: { hash: string; password: string }) => Promise<boolean>>()
  .mockResolvedValue(true);

// OAuth for the MCP server: off in the inert double (no plugin, no grants).
export const getMcpOAuthIssuer = vi.fn<() => Promise<string>>().mockResolvedValue('http://localhost:3001/api/auth');

export const getMcpOAuthJwks = vi.fn<() => Promise<{ keys: unknown[] }>>().mockResolvedValue({ keys: [] });

export const getMcpOAuthServerMetadata = vi.fn<() => Promise<null | Record<string, unknown>>>().mockResolvedValue(null);

export const findMcpOAuthGrant = vi
  .fn<(userId: string, clientId: string, token: { household: string; issuedAt: number; withRefreshToken: boolean }) => Promise<null | { consentedAt: Date; refreshTokenLive: boolean | null; scopes: string[] }>>()
  .mockResolvedValue(null);

export const householdOfUser = vi.fn<(userId: string) => Promise<null | number>>().mockResolvedValue(null);

export const listMcpOAuthGrants = vi
  .fn<(userId: string) => Promise<{ clientId: string; connectedAt: Date; name: null | string; redirectOrigins: string[]; scopes: string[] }[]>>()
  .mockResolvedValue([]);

export const revokeMcpOAuthGrant = vi.fn<(userId: string, clientId: string) => Promise<boolean>>().mockResolvedValue(false);

export const betterAuthReviewUserPort = {
  ensureUser: vi
    .fn<(input: { disableTwoFactor?: boolean; email: string; id: string; name: string; password?: string }) => Promise<{ created: boolean; twoFactorDisabled: boolean }>>()
    .mockResolvedValue({ created: true, twoFactorDisabled: false }),
  findUserByEmail: vi.fn<(email: string) => Promise<null>>().mockResolvedValue(null),
  findUserById: vi.fn<(id: string) => Promise<null>>().mockResolvedValue(null),
};

export const revokeAllMcpOAuthGrants = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined);

export const isMcpOAuthClientRegistered = vi.fn<(clientId: string) => Promise<boolean>>().mockResolvedValue(true);

export const clearMcpOAuthClientGrantEnd = vi.fn<(clientId: string) => Promise<void>>().mockResolvedValue(undefined);

export const mcpOAuthHouseholdReference = vi.fn((tenantKey: number) => `household-${tenantKey}`);

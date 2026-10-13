import type { Request, Response } from 'express';
import { type Mock, vi } from 'vitest';

import type { AuthContext, AuthedSession, AuthedUser } from '../better-auth';

/**
 * Shared test double for `@service/auth/better-auth`.
 *
 * The real module fails fast at import when `BETTER_AUTH_SECRET` / the `DB_*` env is
 * absent (by design for prod/staging), builds a live pg `Pool`, and pulls in
 * `@service/email`. None of that is available or wanted in the unit-test harness, so any
 * test that (even transitively) imports the app, server, or worker used to crash at
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

export const deleteBetterAuthUser = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined);

export const deleteBetterAuthUserByEmail = vi.fn<(email: string) => Promise<void>>().mockResolvedValue(undefined);

export const getAuthSession = vi.fn<(headers: unknown) => Promise<AuthContext | null>>().mockResolvedValue(null);

export const getPrimaryAuthProvider = vi.fn<(userId: string) => Promise<string>>().mockResolvedValue('email');

export const hashPasswordShim = vi.fn<(password: string) => Promise<string>>().mockResolvedValue('hashed-password');

export const isLegacyBcryptHash = vi.fn((hash: string) => hash.startsWith('$2'));

export const verifyPasswordShim = vi
  .fn<(input: { hash: string; password: string }) => Promise<boolean>>()
  .mockResolvedValue(true);

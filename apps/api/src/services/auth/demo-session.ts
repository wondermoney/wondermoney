import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';

/**
 * How long a session of the shared demo account lives.
 *
 * Every demo session ends two hours after it was created, however it was created (the one-click
 * `POST /v1/auth/demo`, or a password sign-in on an instance that publishes the demo password) and
 * however often it is used: better-auth would otherwise slide it forward to its usual seven days on
 * the first `get-session`. Two places enforce it, so neither is the only line:
 *
 * - `capDemoSessionRefresh`, a better-auth `session.update.before` hook, keeps a refresh from moving
 *   the expiry past the deadline, so better-auth itself (and the web app's `get-session`) lets the
 *   session go;
 * - `getAuthSession` refuses, and deletes, a demo session past its deadline, so no API route serves it.
 *
 * The demo account is recognised by its canonical email address, the one the demo seeder creates
 * and `POST /v1/auth/demo` checks before it signs anyone in.
 */
export const DEMO_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const DEMO_ACCOUNT_EMAIL = demoPersona.email;

export function isDemoAccountEmail(email: null | string | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
}

/** The moment a demo session created at `createdAt` stops working. */
export function demoSessionDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DEMO_SESSION_TTL_MS);
}

/** Whether a session is a demo session past its deadline. Sessions of any other account are never "expired" here. */
export function isExpiredDemoSession(
  input: { createdAt: Date | string; email: null | string | undefined },
  now: Date = new Date(),
): boolean {
  if (!isDemoAccountEmail(input.email)) return false;
  return demoSessionDeadline(new Date(input.createdAt)).getTime() <= now.getTime();
}

/** What better-auth's update hook sees of the session being refreshed (`ctx.context.session`). */
interface RefreshContext {
  context?: {
    session?: null | {
      session?: null | { createdAt?: Date | string };
      user?: null | { email?: null | string };
    };
  };
}

/**
 * better-auth `databaseHooks.session.update.before`: a refresh of a demo session may not move its
 * expiry past `createdAt + DEMO_SESSION_TTL_MS`. Returns the clamped update, or `undefined` to leave
 * the update as it is (any other account, or an update that does not touch the expiry).
 *
 * better-auth's `get-session` puts the session it is refreshing on `ctx.context.session` before it
 * writes; without it the hook cannot tell whose session this is and leaves the update alone, and
 * `getAuthSession` still ends the session at the deadline.
 */
export function capDemoSessionRefresh(
  update: Record<string, unknown>,
  context: unknown,
): undefined | { data: Record<string, unknown> } {
  const current = (context as null | RefreshContext | undefined)?.context?.session;
  const createdAt = current?.session?.createdAt;
  if (!current || !createdAt || !isDemoAccountEmail(current.user?.email)) return undefined;

  const requested = update['expiresAt'];
  if (!(requested instanceof Date) && typeof requested !== 'string') return undefined;

  const deadline = demoSessionDeadline(new Date(createdAt));
  if (new Date(requested).getTime() <= deadline.getTime()) return undefined;
  return { data: { ...update, expiresAt: deadline } };
}

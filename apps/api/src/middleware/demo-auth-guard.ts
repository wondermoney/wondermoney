import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { DEMO_READ_ONLY_CODE, DEMO_READ_ONLY_MESSAGE } from '@middleware/demo';
import { getAuthSession } from '@service/auth/better-auth';
import { isDemoAccountEmail } from '@service/auth/demo-session';
import logger from '@utils/logger';

/**
 * The demo account is read-only on better-auth's own routes too.
 *
 * `blockDemoMutation` guards the `/v1` data mounts, but better-auth's handler at `/api/auth` has
 * account routes of its own: change the name, email or password, enable TOTP, add a passkey,
 * link a social login, revoke sessions. On a public demo each of those would let one visitor
 * change the account for everyone (or sign every other visitor out), and listing the sessions
 * would show other visitors' sessions. So a demo session may only do what signing in and out
 * needs; every other write, and the session list, answers 403 `demo_read_only`.
 *
 * Mounted at `/api/auth`, before better-auth's handler. Requests that cannot be account changes
 * (the allowlist) pass without a session lookup, so sign-in traffic costs nothing extra.
 */

/** Writes a demo session may make: signing in (to another account too), signing up and out. */
const DEMO_ALLOWED_WRITE_PREFIXES = ['/sign-in/', '/sign-up/', '/passkey/verify-authentication', '/callback/'];
const DEMO_ALLOWED_WRITES = new Set(['/get-session', '/sign-out']);

/** Reads a demo session may not make: they expose other visitors or start an account change. */
const DEMO_BLOCKED_READS = new Set(['/list-sessions', '/passkey/generate-register-options']);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function blockDemoAuthAccountChanges(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isDemoGuardedAuthRequest(req.method, req.path)) {
    next();
    return;
  }

  let email: null | string = null;
  try {
    email = (await getAuthSession(req.headers))?.user.email ?? null;
  } catch (error) {
    // better-auth answers the request itself and will fail it the same way; nothing to guard.
    logger.warn({ error, path: req.path }, 'Session lookup for the demo guard failed');
  }

  if (isDemoAccountEmail(email)) {
    res.status(StatusCodes.FORBIDDEN).json({ code: DEMO_READ_ONLY_CODE, message: DEMO_READ_ONLY_MESSAGE });
    return;
  }
  next();
}

export function isDemoGuardedAuthRequest(method: string, path: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return DEMO_BLOCKED_READS.has(path);
  if (DEMO_ALLOWED_WRITES.has(path)) return false;
  return !DEMO_ALLOWED_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

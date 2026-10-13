/**
 * Who may create an account (`SIGNUP_MODE`):
 *
 * - `open` (default): anyone.
 * - `invite`: only an email address with a pending household invite.
 * - `closed`: nobody.
 *
 * In every mode the first account on an empty instance is allowed, so whoever installs it can
 * always get in. An unrecognised value fails closed rather than open.
 */

export type SignupMode = 'closed' | 'invite' | 'open';

export interface SignupPolicyDeps {
  hasAnyUser(): Promise<boolean>;
  hasPendingInvite(email: string): Promise<boolean>;
}

type Env = Readonly<Record<string, string | undefined>>;

export async function isSignupAllowed(email: string, deps: SignupPolicyDeps, env: Env = process.env): Promise<boolean> {
  const mode = resolveSignupMode(env);
  if (mode === 'open') return true;
  if (!(await deps.hasAnyUser())) return true;
  if (mode === 'closed') return false;
  return deps.hasPendingInvite(email.trim().toLowerCase());
}

export function resolveSignupMode(env: Env = process.env): SignupMode {
  const value = env['SIGNUP_MODE']?.trim().toLowerCase();
  if (!value || value === 'open') return 'open';
  if (value === 'invite' || value === 'closed') return value;
  return 'closed';
}

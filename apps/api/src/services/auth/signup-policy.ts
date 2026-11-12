import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth/api';

import { isOidcCallback } from '@service/auth/oidc-provider';

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

/**
 * The better-auth plugin that enforces `SIGNUP_MODE` on every way of creating an account
 * (email/password, Google, Apple, OIDC): all of them create the user row, so the gate is that
 * row's `create.before` hook.
 *
 * `OIDC_AUTO_SIGNUP` lifts the gate for one path only: an account created by the OIDC callback.
 * The identity provider then decides who gets in (`OIDC_ALLOWED_GROUPS`); a password sign-up on
 * the same server stays under `SIGNUP_MODE`.
 */
export function signupPolicy({
  deps,
  env = process.env,
  oidc,
}: {
  deps: SignupPolicyDeps;
  env?: Env;
  oidc?: null | { readonly autoSignup: boolean };
}): BetterAuthPlugin {
  return {
    id: 'signup-policy',
    init: () => ({
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (user, context) => {
                if (oidc?.autoSignup && isOidcCallback(context)) return { data: user };
                if (!(await isSignupAllowed(user.email, deps, env))) {
                  throw new APIError('FORBIDDEN', { code: 'SIGNUP_DISABLED', message: 'Sign-up is not open on this server.' });
                }
                return { data: user };
              },
            },
          },
        },
      },
    }),
  };
}

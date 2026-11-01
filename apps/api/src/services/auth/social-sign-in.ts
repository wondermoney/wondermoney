type Env = Readonly<Record<string, string | undefined>>;

const present = (env: Env, key: string) => Boolean(env[key]?.trim());

/**
 * Google sign-in works only with both OAuth credentials; better-auth registers the provider under
 * the same condition (`services/auth/better-auth.ts`). Clients hide the button otherwise, since
 * the sign-in call would fail with `PROVIDER_NOT_FOUND`.
 */
export function isGoogleSignInConfigured(env: Env = process.env): boolean {
  return present(env, 'GOOGLE_CLIENT_ID') && present(env, 'GOOGLE_CLIENT_SECRET');
}

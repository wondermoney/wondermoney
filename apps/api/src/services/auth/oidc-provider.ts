import { loadAuthConfiguration } from '@config/configuration';

/**
 * The OIDC provider's id and the request test, apart from the plugin itself (`oidc.ts`) so the
 * sign-up gate and the instance description can ask without loading it.
 */

/** better-auth's provider id for single sign-on: `/sign-in/social` `provider`, `/callback/oidc`. */
export const OIDC_PROVIDER_ID = 'oidc';

/** Whether a better-auth endpoint context is the OIDC provider's callback. */
type Env = Readonly<Record<string, string | undefined>>;

export function isOidcCallback(context: unknown): boolean {
  const ctx = context as null | undefined | { params?: { id?: unknown }; path?: unknown };
  return ctx?.path === '/callback/:id' && ctx.params?.id === OIDC_PROVIDER_ID;
}

/**
 * What `GET /v1/instance` says about sign-in: the button label for single sign-on (null when
 * none is configured), and whether the password form is offered at all (`OIDC_ONLY`).
 */
export function signInMethods(env: Env = process.env): { oidc: null | { name: string }; passwordSignIn: boolean } {
  const oidc = loadAuthConfiguration(env).oidc;
  return { oidc: oidc ? { name: oidc.displayName } : null, passwordSignIn: !oidc?.only };
}

import { defineRequestState } from '@better-auth/core/context';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { genericOAuth } from 'better-auth/plugins';

import type { OidcConfiguration } from '@config/configuration';
import { isOidcCallback, OIDC_PROVIDER_ID } from '@service/auth/oidc-provider';

export { isOidcCallback, OIDC_PROVIDER_ID };

/**
 * Single sign-on with a self-hoster's OpenID Connect provider (Authentik, Keycloak, Authelia,
 * Zitadel, ...), configured from the environment only (`OIDC_*`, validated in
 * `loadAuthConfiguration`).
 *
 * Built on better-auth's generic OAuth plugin, which ships with the installed better-auth: the
 * provider is found through the issuer's discovery document, the authorization-code flow uses
 * PKCE and a nonce, and the id_token is verified against the issuer's JWKS before any claim is
 * read. The provider is an ordinary social provider afterwards, so sign-in runs through the same
 * `/sign-in/social` and `/callback/oidc` endpoints as Google: the browser flow on web and on
 * mobile, the auth rate limit, `twoFactorOAuthGuard` and the expo deep-link handling all apply
 * unchanged. (better-auth's SSO plugin is a separate package built for providers registered at
 * runtime, per organization, in its own tables; one provider from the environment needs none of
 * that.)
 *
 * What this module adds on top:
 *
 * - **Verified email only.** A sign-in whose `email_verified` claim is not true is refused
 *   (`OIDC_EMAIL_NOT_VERIFIED`) unless `OIDC_ALLOW_UNVERIFIED_EMAIL` is set, and even then an
 *   unverified address never links to an existing account: better-auth links an OIDC identity
 *   to the account with the same email only when the provider verified it and the account's own
 *   address is verified too. `oidc` is deliberately not a trusted provider.
 * - **Allowed groups.** With `OIDC_ALLOWED_GROUPS`, only members of one of those groups (or of
 *   an admin group) may sign in, checked on every sign-in, not only the first
 *   (`OIDC_GROUP_NOT_ALLOWED`).
 * - **Admin groups.** With `OIDC_ADMIN_GROUPS`, every sign-in sets the instance-admin flag from
 *   the groups claim, granting and revoking alike. Only that one boolean is kept (`oidcAdmin`
 *   on the better-auth user, and `Appuser.accountType` through `onAdminClaim`); the provider's
 *   tokens, which carry the whole group list, are not stored on the account row.
 * - **OIDC only.** With `OIDC_ONLY`, password sign-in, sign-up and reset are refused
 *   (`PASSWORD_SIGN_IN_DISABLED`). Passkeys keep working: one can only be added from a
 *   signed-in session, and it is a phishing-resistant way back in while the provider is down.
 * - A client-supplied id_token for this provider is refused: sign-in goes through the
 *   provider's own login page, so its MFA and policies apply.
 */

export interface OidcDependencies {
  /** Mirror the admin claim onto the app user (`Appuser.accountType`), when one exists yet. */
  onAdminClaim(userId: string, admin: boolean): Promise<void>;
}

type ClaimVerdict =
  | { admin: boolean | null; ok: true }
  | { error: string; errorDescription: string; ok: false };

const PASSWORD_PATHS = new Set(['/request-password-reset', '/reset-password', '/sign-in/email', '/sign-up/email']);

/** `true`, or the string some providers send. */
const isTrue = (value: unknown): boolean => value === true || value === 'true';

/** The groups claim as a list: an array of names, or one name as a string. */
export function groupsFromClaim(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((group): group is string => typeof group === 'string');
  return [];
}

/** What the id_token's claims allow: refuse, or admit with the admin flag to set (null: leave it). */
export function evaluateOidcClaims(claims: Record<string, unknown>, config: OidcConfiguration): ClaimVerdict {
  if (!config.allowUnverifiedEmail && !isTrue(claims['email_verified'])) {
    return {
      error: 'OIDC_EMAIL_NOT_VERIFIED',
      errorDescription: 'Your identity provider has not verified your email address.',
      ok: false,
    };
  }
  const groups = new Set(groupsFromClaim(claims[config.groupsClaim]));
  const admin = config.adminGroups.some((group) => groups.has(group));
  if (config.allowedGroups.length > 0 && !admin && !config.allowedGroups.some((group) => groups.has(group))) {
    return {
      error: 'OIDC_GROUP_NOT_ALLOWED',
      errorDescription: 'Your account is not in a group that may use this server.',
      ok: false,
    };
  }
  return { admin: config.adminGroups.length > 0 ? admin : null, ok: true };
}

/** The verdict reached while this request validated the provider's claims, for the after hook. */
const admittedThisRequest = defineRequestState<null | { admin: boolean | null }>(() => null);

const oidcPolicy = (config: OidcConfiguration, deps: OidcDependencies): BetterAuthPlugin => ({
  hooks: {
    after: [
      {
        // Runs before `twoFactorOAuthGuard` (plugin order in better-auth.ts), while the new
        // session still names the user: a two-factor sign-in still records the claim.
        handler: createAuthMiddleware(async (ctx) => {
          const userId = ctx.context.newSession?.user.id;
          const verdict = await admittedThisRequest.get();
          if (!userId || verdict?.admin === undefined || verdict.admin === null) return;
          await ctx.context.internalAdapter.updateUser(userId, { oidcAdmin: verdict.admin });
          await deps.onAdminClaim(userId, verdict.admin);
        }),
        matcher: (context) => isOidcCallback(context),
      },
    ],
    before: [
      {
        handler: createAuthMiddleware((ctx) => {
          if (ctx.path === '/sign-in/social') {
            const body = ctx.body as undefined | { idToken?: unknown; provider?: unknown };
            if (body?.provider === OIDC_PROVIDER_ID && body.idToken !== undefined) {
              return Promise.reject(new APIError('BAD_REQUEST', { code: 'ID_TOKEN_NOT_SUPPORTED', message: 'Sign in through the identity provider.' }));
            }
            return Promise.resolve();
          }
          if (config.only && PASSWORD_PATHS.has(ctx.path)) {
            return Promise.reject(new APIError('FORBIDDEN', {
              code: 'PASSWORD_SIGN_IN_DISABLED',
              message: `This server signs in with ${config.displayName} only.`,
            }));
          }
          return Promise.resolve();
        }),
        matcher: (context) => context.path === '/sign-in/social' || PASSWORD_PATHS.has(context.path ?? ''),
      },
    ],
  },
  id: 'oidc-policy',
  init: () => ({
    options: {
      databaseHooks: {
        // The provider's tokens are never used after sign-in, and the id_token (often the
        // access token too) lists every group the person is in. Keep the account row to the
        // subject that identifies them.
        account: {
          create: {
            before: (account) => Promise.resolve(account.providerId === OIDC_PROVIDER_ID
              ? { data: { ...account, accessToken: null, idToken: null, refreshToken: null } }
              : { data: account }),
          },
          update: {
            before: (account) => Promise.resolve(account.providerId === OIDC_PROVIDER_ID
              ? { data: { ...account, accessToken: null, idToken: null, refreshToken: null } }
              : { data: account }),
          },
        },
      },
      user: {
        // better-auth calls this with the provider's fresh, verified claims on every OIDC
        // sign-in: a new account, a link to an existing one, and a returning user.
        validateUserInfo: async ({ source }) => {
          if (source.oauth?.providerId !== OIDC_PROVIDER_ID) return undefined;
          const verdict = evaluateOidcClaims(source.oauth.profile ?? {}, config);
          if (!verdict.ok) return { error: verdict.error, errorDescription: verdict.errorDescription };
          await admittedThisRequest.set({ admin: verdict.admin });
          return undefined;
        },
      },
    },
  }),
  schema: {
    user: {
      fields: {
        // The admin claim from the last OIDC sign-in; null for anyone the groups never set it for.
        oidcAdmin: { input: false, required: false, type: 'boolean' },
      },
    },
  },
});

/** The plugins that give better-auth this instance's OIDC provider. */
export function oidcPlugins(config: OidcConfiguration, deps: OidcDependencies): BetterAuthPlugin[] {
  return [
    oidcPolicy(config, deps),
    genericOAuth({
      config: [
        {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          discoveryUrl: config.discoveryUrl,
          // A provider without a name claim still gives the account something to show.
          mapProfileToUser: (profile) => {
            const name = [profile.name, profile['preferred_username'], profile.email]
              .find((value): value is string => typeof value === 'string' && value.trim() !== '');
            return name ? { name } : {};
          },
          name: config.displayName,
          pkce: true,
          providerId: OIDC_PROVIDER_ID,
          requireIdTokenVerification: true,
          scopes: [...config.scopes],
        },
      ],
    }),
  ];
}

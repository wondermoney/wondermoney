import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie, expireCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';

/**
 * Lifetime of the intermediate "2FA pending" cookie. Shared with the `twoFactor`
 * plugin config so the OAuth-initiated challenge and the credential-initiated one
 * expire the same way.
 */
export const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 60 * 5;

// Internal cookie name the twoFactor plugin uses for its pending-verification state
// (dist/plugins/two-factor/constant.mjs). NOT a public export — pinned to
// better-auth 1.7.12 (the version this lockfile resolves). If a future version renames
// it, this guard fails CLOSED (the OAuth sign-in for a 2FA user is blocked, not
// bypassed), which the version-pin test below is meant to catch on upgrade.
const TWO_FACTOR_PENDING_COOKIE = 'two_factor';
const SENSITIVE_SESSION_HEADERS = ['set-auth-token', 'set-auth-jwt'];

const scrubSessionHeaders = (ctx: { context: { responseHeaders?: Headers }; responseHeaders?: Headers; }): void => {
  const scopes = [ctx.responseHeaders, ctx.context.responseHeaders];
  for (const headers of scopes) {
    if (!(headers instanceof Headers)) continue;
    for (const name of SENSITIVE_SESSION_HEADERS) headers.delete(name);
    const exposed = headers.get('access-control-expose-headers');
    if (exposed) {
      const remaining = exposed.split(',').map((name) => name.trim()).filter((name) =>
        !SENSITIVE_SESSION_HEADERS.some((sensitive) => sensitive.toLowerCase() === name.toLowerCase()),
      );
      if (remaining.length) headers.set('access-control-expose-headers', remaining.join(', '));
      else headers.delete('access-control-expose-headers');
    }
  }
};

/**
 * Enforce TOTP two-factor on OAuth callbacks and native social ID-token sign-in.
 *
 * better-auth's `twoFactor` plugin only gates the credential endpoints
 * (`/sign-in/email|username|phone-number`) — by design; see
 * https://www.better-auth.com/docs/plugins/2fa ("...OAuth/social... are not gated by
 * 2FA by default... add custom hook handling for those endpoints"). Without this, a
 * user with `twoFactorEnabled = true` gets a full session immediately after Google
 * sign-in, skipping the second factor.
 *
 * This after-hook fires on the OAuth callback (`/callback/:id`), and — for a
 * 2FA-enabled user — strips the session better-auth just issued and plants the exact
 * same `two_factor` pending cookie + verification records the credential flow uses, so
 * the existing `/two-factor/verify-totp` endpoint works unchanged. Unlike the credential
 * hook it does NOT return `{ twoFactorRedirect: true }` JSON (the callback is a full-page
 * browser redirect, not a fetch), so the original 302 to the client `callbackURL` is
 * preserved; `web`'s `/auth/complete` route then finds no session and routes the user to
 * the `/auth/mfa` challenge.
 *
 * Non-2FA users are unaffected (early return). Fails closed. Reaches better-auth
 * internal context APIs, mirroring the plugin's own hook — re-verify on any better-auth bump.
 */
export const twoFactorOAuthGuard = (): BetterAuthPlugin => ({
  hooks: {
    after: [
      {
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.path !== '/callback/:id' && ctx.path !== '/sign-in/social') return;
          const pendingSession = ctx.context.newSession;
          // No session was created (account-link / error branches) or the user has no 2FA — nothing to gate.
          if (!pendingSession) return;
          if (!(pendingSession.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;

          const isNative = ctx.path === '/sign-in/social';
          // Undo the full session before awaiting anything that can fail.
          deleteSessionCookie(ctx, true);
          ctx.context.setNewSession(null);
          scrubSessionHeaders(ctx);
          const removeLocation = (): void => {
            ctx.responseHeaders.delete('location');
            ctx.context.responseHeaders?.delete('location');
          };
          if (isNative) removeLocation();
          try {
            await ctx.context.internalAdapter.deleteSession(pendingSession.session.token);

            // Re-create the twoFactor plugin's pending-verification state.
            const expiresAt = new Date(Date.now() + TWO_FACTOR_COOKIE_MAX_AGE_SECONDS * 1000);
            const identifier = `2fa-${generateRandomString(20)}`;
            await ctx.context.internalAdapter.createVerificationValue({
              expiresAt,
              identifier,
              value: pendingSession.user.id,
            });
            await ctx.context.internalAdapter.createVerificationValue({
              expiresAt,
              identifier: `2fa-attempts-${identifier}`,
              value: '0',
            });
            const cookie = ctx.context.createAuthCookie(TWO_FACTOR_PENDING_COOKIE, {
              maxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
            });
            await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
            scrubSessionHeaders(ctx);
            if (isNative) {
              const factor = await ctx.context.adapter.findOne<{ verified?: boolean }>({
                model: 'twoFactor',
                where: [{ field: 'userId', value: pendingSession.user.id }],
              });
              removeLocation();
              return await ctx.json({ twoFactorMethods: factor && factor.verified !== false ? ['totp'] : [], twoFactorRedirect: true });
            }
            // Preserve callback redirect for browser OAuth.
            return undefined;
          } catch {
            ctx.context.setNewSession(null);
            scrubSessionHeaders(ctx);
            deleteSessionCookie(ctx, true);
            expireCookie(ctx, ctx.context.createAuthCookie(TWO_FACTOR_PENDING_COOKIE));
            removeLocation();
            throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Unable to complete sign-in' });
          }
        }),
        matcher: (context) => context.path === '/callback/:id' || context.path === '/sign-in/social',
      },
    ],
    before: [
      {
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as undefined | { idToken?: { nonce?: string }; provider?: string; };
          if (
            ctx.path === '/sign-in/social' &&
            body?.idToken &&
            (body.provider === 'google' || body.provider === 'apple') &&
            (typeof body.idToken.nonce !== 'string' || !body.idToken.nonce.trim())
          ) {
            return ctx.json({ message: 'A nonce is required for native identity-token sign-in' }, { status: 400 });
          }
          return undefined;
        }),
        matcher: (context) => context.path === '/sign-in/social',
      },
    ],
  },
  id: 'two-factor-oauth-guard',
});

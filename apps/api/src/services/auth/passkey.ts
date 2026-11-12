import { passkey, PASSKEY_ERROR_CODES } from '@better-auth/passkey';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';

/**
 * Passkeys (WebAuthn) through better-auth's passkey plugin, plus the two things WonderMoney
 * adds on top: a last-used date and a 404 for anyone else's passkey.
 *
 * Where a passkey belongs. A passkey is bound to a relying-party ID, a hostname, and the
 * browser only offers it on pages under that hostname. The ceremony runs on the web app, not
 * on the API (the web app calls the API, but `navigator.credentials` runs in the page), so
 * the relying party is the web app's address: `APP_URL`'s hostname, with `APP_URL`'s origin as
 * the only origin an assertion may come from. That holds whether the API sits on a sibling
 * hostname (`api.money.example.com`) or behind the same one (`money.example.com/v1`, the
 * one-hostname setup), so no new variable is needed. Moving the web app to another hostname
 * orphans every registered passkey: the browser will not offer them there.
 *
 * Why a passkey sign-in is a full session for a two-factor account. A passkey is
 * phishing-resistant by construction (the browser signs only for the relying party's origin),
 * and with `userVerification: 'required'` every assertion proves both possession of the device
 * and the PIN or biometric that unlocks it. That is two factors, so asking for a TOTP code
 * afterwards would add friction without adding a factor. Nothing has to be switched off for
 * it: the `twoFactor` plugin only gates `/sign-in/email|username|phone-number`, and
 * `twoFactorOAuthGuard` only gates the social paths, so `/passkey/verify-authentication`
 * already issues a full session. The integration test pins that.
 */

/** The web app's relying party: its hostname and its origin. */
export interface PasskeyRelyingParty {
  origin: string;
  rpID: string;
}

/** Derive the relying party from `APP_URL`. A path on `APP_URL` does not change it. */
export function passkeyRelyingParty(appUrl: string): PasskeyRelyingParty {
  const url = new URL(appUrl);
  return { origin: url.origin, rpID: url.hostname };
}

const OWNED_PASSKEY_PATHS = new Set(['/passkey/delete-passkey', '/passkey/update-passkey']);

/**
 * Adds `lastUsedAt` to the plugin's `passkey` table and answers 404 when a signed-in user
 * renames or deletes a passkey that is not theirs.
 *
 * The plugin itself answers 401 for another user's passkey and 404 for a missing one, which
 * tells a caller that an id exists. Answering 404 for both, before the plugin runs, gives
 * nothing away and keeps a 401 meaning "not signed in". A request without a session falls
 * through to the plugin, which answers 401.
 */
const passkeyAccountRules = (): BetterAuthPlugin => ({
  hooks: {
    before: [
      {
        handler: createAuthMiddleware(async (ctx) => {
          const id = (ctx.body as undefined | { id?: unknown })?.id;
          if (typeof id !== 'string' || !id) return;
          const session = await getSessionFromCtx(ctx);
          if (!session) return;
          const owned = await ctx.context.adapter.findOne<{ userId: string }>({
            model: 'passkey',
            where: [{ field: 'id', value: id }],
          });
          if (owned?.userId !== session.user.id) throw APIError.from('NOT_FOUND', PASSKEY_ERROR_CODES.PASSKEY_NOT_FOUND);
        }),
        matcher: (context) => OWNED_PASSKEY_PATHS.has(context.path ?? ''),
      },
    ],
  },
  id: 'passkey-account-rules',
  schema: {
    passkey: {
      fields: {
        // Set on every successful sign-in with the passkey; null until the first one.
        lastUsedAt: { input: false, required: false, type: 'date' },
      },
    },
  },
});

/** The plugins that give better-auth passkeys for this instance's web app. */
export function passkeyPlugins({ appName, appUrl }: { appName: string; appUrl: string }): BetterAuthPlugin[] {
  const { origin, rpID } = passkeyRelyingParty(appUrl);
  return [
    passkey({
      authentication: {
        afterVerification: async ({ clientData, ctx }) => {
          await ctx.context.adapter.update({
            model: 'passkey',
            update: { lastUsedAt: new Date() },
            where: [{ field: 'credentialID', value: clientData.id }],
          });
        },
      },
      // A discoverable credential is what lets the browser offer it from the email field
      // (conditional UI) and sign in without typing an address first; required user
      // verification is what makes one passkey count as two factors (see above).
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      origin,
      rpID,
      rpName: appName,
    }),
    passkeyAccountRules(),
  ];
}

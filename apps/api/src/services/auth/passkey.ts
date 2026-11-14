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
 * The mobile app uses the same relying party. Its passkeys work only when the web app on that
 * hostname vouches for the app (`/.well-known/apple-app-site-association` and
 * `/.well-known/assetlinks.json`, served by the web app) and the app build lists the hostname
 * among its associated domains, so in practice only for the server the app was built for.
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

const COLON_FINGERPRINT = /^[\dA-F]{2}(?::[\dA-F]{2}){31}$/i;
const BARE_FINGERPRINT = /^[\dA-F]{64}$/i;

/**
 * The SHA-256 fingerprints of the Android app's signing certificates
 * (`ANDROID_APP_CERT_SHA256`, comma-separated), as `keytool` and the Play Console print them
 * (`AB:CD:…`, 32 bytes) or as bare hex. Anything else is left out, so a typo turns Android
 * passkeys off rather than accepting some other app.
 */
export function androidCertFingerprints(value: string | undefined): string[] {
  const hex = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => COLON_FINGERPRINT.test(entry) || BARE_FINGERPRINT.test(entry))
    .map((entry) => entry.replaceAll(':', '').toUpperCase());
  return [...new Set(hex)];
}

/**
 * The origin an Android app's passkey assertion reports. Android's Credential Manager does not
 * report the website's origin for a native app: it reports `android:apk-key-hash:` and the
 * unpadded base64url of the app's signing-certificate SHA-256, after checking the relying
 * party's `/.well-known/assetlinks.json` lists that certificate.
 */
export function androidApkKeyHashOrigin(fingerprintHex: string): string {
  return `android:apk-key-hash:${Buffer.from(fingerprintHex, 'hex').toString('base64url')}`;
}

/**
 * Every origin a passkey ceremony may come from: the web app's, and one per Android signing
 * certificate the operator listed. The iOS app needs nothing here: Apple's AuthenticationServices
 * reports `https://<rpID>`, which is the web app's origin when `APP_URL` has no port.
 */
export function passkeyOrigins(appUrl: string, androidFingerprints: readonly string[] = []): string[] {
  return [passkeyRelyingParty(appUrl).origin, ...androidFingerprints.map(androidApkKeyHashOrigin)];
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

/**
 * The plugins that give better-auth passkeys for this instance's web app, and for the mobile
 * app when `androidCertFingerprints` names its Android signing certificates (see
 * `passkeyOrigins`).
 */
export function passkeyPlugins({ androidCertFingerprints: fingerprints = [], appName, appUrl }: {
  androidCertFingerprints?: readonly string[];
  appName: string;
  appUrl: string;
}): BetterAuthPlugin[] {
  const { rpID } = passkeyRelyingParty(appUrl);
  const origin = passkeyOrigins(appUrl, fingerprints);
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

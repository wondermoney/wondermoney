/**
 * The files that let the WonderMoney mobile app use this web app's passkeys.
 *
 * A passkey belongs to the web app's hostname (the API's relying party is `APP_URL`'s). iOS and
 * Android offer it to a native app only when that hostname vouches for the app:
 *
 * - iOS reads `/.well-known/apple-app-site-association` and needs the app's
 *   `<team ID>.<bundle ID>` under `webcredentials`.
 * - Android reads `/.well-known/assetlinks.json` and needs the app's package and signing
 *   certificate under the `get_login_creds` relation.
 *
 * Both are built from the web server's environment, read on each request so one image serves
 * any instance: `IOS_APP_TEAM_ID` and `IOS_APP_BUNDLE_ID`; `ANDROID_APP_PACKAGE` and
 * `ANDROID_APP_CERT_SHA256` (comma-separated SHA-256 fingerprints, as `keytool` prints them).
 * With a value missing or malformed, the file is not served (404), so the instance vouches for
 * no app.
 */

type Env = Record<string, string | undefined>;

// Apple's team ID is ten uppercase letters and digits.
const TEAM_ID = /^[A-Z\d]{10}$/;
// A bundle ID: letters, digits, hyphens and dots (Apple's rule).
const BUNDLE_ID = /^[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)+$/;
// An Android application ID: two or more segments, each starting with a letter.
const ANDROID_PACKAGE = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/;
const COLON_FINGERPRINT = /^[\dA-F]{2}(?::[\dA-F]{2}){31}$/i;
const BARE_FINGERPRINT = /^[\dA-F]{64}$/i;

const read = (env: Env, key: string): string => env[key]?.trim() ?? "";

/** The signing-certificate fingerprints, in the `AB:CD:…` form assetlinks.json uses. */
export function androidCertFingerprints(value: string | undefined): string[] {
  const normalized = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(
      (entry) => COLON_FINGERPRINT.test(entry) || BARE_FINGERPRINT.test(entry),
    )
    .map((entry) =>
      entry
        .replaceAll(":", "")
        .toUpperCase()
        .match(/.{2}/g)!
        .join(":"),
    );
  return [...new Set(normalized)];
}

export interface AppleAppSiteAssociation {
  webcredentials: { apps: string[] };
}

/** `/.well-known/apple-app-site-association`, or null when the iOS app isn't configured. */
export function appleAppSiteAssociation(
  env: Env,
): AppleAppSiteAssociation | null {
  const teamId = read(env, "IOS_APP_TEAM_ID");
  const bundleId = read(env, "IOS_APP_BUNDLE_ID");
  if (!TEAM_ID.test(teamId) || !BUNDLE_ID.test(bundleId)) return null;
  return { webcredentials: { apps: [`${teamId}.${bundleId}`] } };
}

export type AssetLinks = Array<{
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}>;

/** `/.well-known/assetlinks.json`, or null when the Android app isn't configured. */
export function androidAssetLinks(env: Env): AssetLinks | null {
  const packageName = read(env, "ANDROID_APP_PACKAGE");
  const fingerprints = androidCertFingerprints(
    env["ANDROID_APP_CERT_SHA256"],
  );
  if (!ANDROID_PACKAGE.test(packageName) || fingerprints.length === 0)
    return null;
  return [
    {
      // Passkeys and saved passwords only: no app links, so no web URL opens the app.
      relation: ["delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/** The JSON response for a well-known file, or a plain 404 when it isn't configured. */
export function wellKnownResponse(content: unknown): Response {
  if (content === null) return new Response("Not found", { status: 404 });
  return Response.json(content, {
    // Short, so an operator's change (or a new signing key) reaches Apple's CDN and Google soon.
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

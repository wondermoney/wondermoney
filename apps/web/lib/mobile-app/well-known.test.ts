import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { GET as getAppleAppSiteAssociation } from "@/app/.well-known/apple-app-site-association/route";
import { GET as getAssetLinks } from "@/app/.well-known/assetlinks.json/route";

import { androidCertFingerprints } from "./associated-apps";

/**
 * The two files iOS and Android read before they let the mobile app use this web app's
 * passkeys. Both are built from the web server's environment and are absent (404) until the
 * operator sets it. The values here are made up.
 */
const TEAM_ID = "ABCDE12345";
const BUNDLE_ID = "com.example.money";
const PACKAGE = "com.example.money";
const FINGERPRINT = Array.from({ length: 32 }, (_, index) =>
  (index * 7 + 16).toString(16).toUpperCase().padStart(2, "0"),
).join(":");
const OTHER_FINGERPRINT = Array(32).fill("0A").join(":");

const KEYS = [
  "IOS_APP_TEAM_ID",
  "IOS_APP_BUNDLE_ID",
  "ANDROID_APP_PACKAGE",
  "ANDROID_APP_CERT_SHA256",
];

function stubEnv(values: Partial<Record<string, string>>) {
  for (const key of KEYS) vi.stubEnv(key, values[key] ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test("apple-app-site-association names the iOS app for passkeys, as JSON", async () => {
  stubEnv({ IOS_APP_BUNDLE_ID: BUNDLE_ID, IOS_APP_TEAM_ID: TEAM_ID });

  const response = getAppleAppSiteAssociation();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json\b/,
  );
  assert.deepEqual(await response.json(), {
    webcredentials: { apps: [`${TEAM_ID}.${BUNDLE_ID}`] },
  });
});

test("apple-app-site-association is not served until both iOS values are set and valid", async () => {
  for (const values of [
    {},
    { IOS_APP_TEAM_ID: TEAM_ID },
    { IOS_APP_BUNDLE_ID: BUNDLE_ID },
    { IOS_APP_BUNDLE_ID: BUNDLE_ID, IOS_APP_TEAM_ID: "abc" },
    { IOS_APP_BUNDLE_ID: "not a bundle", IOS_APP_TEAM_ID: TEAM_ID },
  ]) {
    stubEnv(values);
    const response = getAppleAppSiteAssociation();
    assert.equal(response.status, 404, JSON.stringify(values));
  }
});

test("assetlinks.json lets the Android app sign in with passkeys, and nothing else, as JSON", async () => {
  stubEnv({
    ANDROID_APP_CERT_SHA256: `${FINGERPRINT}, ${OTHER_FINGERPRINT.toLowerCase().replaceAll(":", "")}`,
    ANDROID_APP_PACKAGE: PACKAGE,
  });

  const response = getAssetLinks();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json\b/,
  );
  assert.deepEqual(await response.json(), [
    {
      relation: ["delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: PACKAGE,
        sha256_cert_fingerprints: [FINGERPRINT, OTHER_FINGERPRINT],
      },
    },
  ]);
});

test("assetlinks.json is not served until the package and a valid fingerprint are set", async () => {
  for (const values of [
    {},
    { ANDROID_APP_PACKAGE: PACKAGE },
    { ANDROID_APP_CERT_SHA256: FINGERPRINT },
    { ANDROID_APP_CERT_SHA256: "AB:CD", ANDROID_APP_PACKAGE: PACKAGE },
    { ANDROID_APP_CERT_SHA256: FINGERPRINT, ANDROID_APP_PACKAGE: "money" },
  ]) {
    stubEnv(values);
    const response = getAssetLinks();
    assert.equal(response.status, 404, JSON.stringify(values));
  }
});

test("fingerprints are read as keytool prints them or as bare hex, deduplicated, typos dropped", () => {
  assert.deepEqual(androidCertFingerprints(undefined), []);
  assert.deepEqual(
    androidCertFingerprints(
      `${FINGERPRINT.toLowerCase()},${FINGERPRINT.replaceAll(":", "")},AB:CD,`,
    ),
    [FINGERPRINT],
  );
});

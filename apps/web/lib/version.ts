/**
 * The release identity shown in the app, from the build (`next.config.ts`) and, for the
 * server, from `GET /v1/instance`.
 *
 * One release version: the git tag. `WM_VERSION` carries it into the build, so the web app
 * and the API report the same number for the same release. A build that was not made from a
 * release reports `dev`, and the commit it was built from is shown beside it.
 */

export interface BuildIdentity {
  /** The release version (`1.2.0`), or `dev` for an unstamped build. */
  version: string;
  /** The short commit the build was made from, or null when unknown. */
  commit: null | string;
}

/** This web build, inlined at build time by `next.config.ts`. */
export const appBuild: BuildIdentity = {
  commit: process.env.PKG_COMMIT?.trim() || null,
  version: process.env.PKG_VERSION?.trim() || "dev",
};

/** `1.2.0 (abc1234)`, or just the version when the commit is unknown. */
export function formatBuild({ commit, version }: BuildIdentity): string {
  return commit ? `${version} (${commit})` : version;
}

/**
 * Whether two versions are both real releases and differ. A `dev` build has no release to
 * compare, and an older server that does not report a version cannot be compared either, so
 * neither is reported as a mismatch.
 */
export function versionsDiffer(
  appVersion: null | string | undefined,
  serverVersion: null | string | undefined,
): boolean {
  return (
    isReleaseVersion(appVersion) &&
    isReleaseVersion(serverVersion) &&
    appVersion !== serverVersion
  );
}

function isReleaseVersion(
  version: null | string | undefined,
): version is string {
  return Boolean(version && version !== "dev" && version !== "unknown");
}

/**
 * One line for a bug report: the app's version and commit, then the server's. Unknown
 * values are said to be unknown rather than left out, so a missing server version is not
 * mistaken for a matching one.
 */
export function formatVersionInfo({
  app,
  server,
}: {
  app: BuildIdentity;
  server: BuildIdentity | null;
}): string {
  return `WonderMoney app ${formatBuild(app)}, server ${
    server ? formatBuild(server) : "unknown"
  }`;
}

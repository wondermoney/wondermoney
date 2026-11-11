export type BuildIdentity = Readonly<{
  /** The release version (`1.2.0`), or `dev` for an unstamped build. */
  version: string
  /** The short commit the build was made from, or null when unknown. */
  commit: string | null
}>

/** `1.2.0 (abc1234)`, or just the version when the commit is unknown. */
export function formatBuild({ version, commit }: BuildIdentity): string {
  return commit ? `${version} (${commit})` : version
}

/**
 * One line for a bug report: the app's version, then the connected server's version and
 * commit. Unknown values are said to be unknown rather than left out, so a missing server
 * version is not mistaken for a matching one.
 */
export function formatVersionInfo({
  app,
  server,
}: {
  app: BuildIdentity | null
  server: BuildIdentity | null
}): string {
  return `WonderMoney app ${app ? formatBuild(app) : 'unknown'}, server ${server ? formatBuild(server) : 'unknown'}`
}

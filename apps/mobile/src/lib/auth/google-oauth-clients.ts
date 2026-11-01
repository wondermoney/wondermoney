import clients from './google-oauth-clients.json'

/**
 * Public OAuth client identifiers for the `wondermoney` Google Cloud project.
 *
 * These are client *identifiers*, not secrets: they ship inside the binary (the iOS URL
 * scheme lands verbatim in Info.plist) and Google documents them as public. The client
 * secret lives only in the API's server configuration and never here.
 *
 * They live in JSON, not TypeScript, for one reason: `app.config.ts` needs the same
 * values for the native config plugin, and Expo's config loader transpiles only
 * `app.config.ts` itself — it cannot resolve an imported `.ts` module, but it resolves
 * JSON natively. One file, so the native scheme and the runtime client ID cannot drift.
 */
export const googleOAuthClients: Readonly<{
  /** Server-side client the API validates ID tokens against; Android's server client ID. */
  webClientId: string
  /** `GIDConfiguration.clientID` for the native iOS flow. */
  iosClientId: string
  /** Reversed iOS client ID; the URL scheme Google's iOS SDK redirects back through. */
  iosUrlScheme: string
}> = clients

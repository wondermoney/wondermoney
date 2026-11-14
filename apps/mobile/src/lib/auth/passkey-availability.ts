import Constants from 'expo-constants'

/**
 * Whether the app offers passkeys on the server it talks to.
 *
 * A passkey belongs to the web app's hostname (the server's relying party ID,
 * `features.passkeyRpId`). The phone hands one to this app only for a hostname the build lists
 * among its associated domains (`WONDERMONEY_PASSKEY_DOMAINS`, see app.config.ts), so on any
 * other server, a self-hosted one included, a passkey prompt could only fail: the option is
 * hidden and the other sign-in methods remain.
 */
export type PasskeyAvailabilityInput = Readonly<{
  /** `features.passkey`; undefined while the description loads or on an older server. */
  serverPasskey: boolean | undefined
  /** `features.passkeyRpId`; undefined on a server older than it. */
  rpId: string | undefined
  /** The hostnames this build is associated with. */
  appDomains: readonly string[]
  /** Whether the device can use passkeys at all. */
  deviceSupported: boolean
}>

export function isPasskeyAvailable({ serverPasskey, rpId, appDomains, deviceSupported }: PasskeyAvailabilityInput): boolean {
  if (serverPasskey !== true || !deviceSupported || !rpId) return false
  const host = rpId.trim().toLowerCase()
  return appDomains.some((domain) => domain === host)
}

/** The build's associated passkey domains, written into `extra.passkeyDomains` by app.config.ts. */
export function appPasskeyDomains(extra: unknown = Constants.expoConfig?.extra): readonly string[] {
  const domains = (extra as { passkeyDomains?: unknown } | null | undefined)?.passkeyDomains
  if (!Array.isArray(domains)) return []
  return domains
    .filter((domain): domain is string => typeof domain === 'string' && domain.length > 0)
    .map((domain) => domain.toLowerCase())
}

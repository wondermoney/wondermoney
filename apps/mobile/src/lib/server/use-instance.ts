import { useQuery } from '@tanstack/react-query'

import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { nativePasskeyAuthenticator } from '@/lib/auth/native-passkeys'
import { appPasskeyDomains, isPasskeyAvailable } from '@/lib/auth/passkey-availability'

import { fetchInstance, hostOf, type InstanceDescription } from './server-connection'

type Features = InstanceDescription['features']

/**
 * What the server the app currently talks to offers (`GET /v1/instance`). Public and stable for
 * the life of a deploy, so it is fetched once per server; the query key carries the server, so
 * switching servers asks the new one.
 */
function useInstance() {
  const apiBaseUrl = useServerSwitch()?.apiBaseUrl ?? null
  return useQuery({
    enabled: apiBaseUrl !== null,
    queryFn: async () => {
      const fetched = await fetchInstance(apiBaseUrl as string)
      if (fetched.status !== 'ok') throw new Error(`GET /v1/instance: ${fetched.status}`)
      return fetched.instance
    },
    queryKey: instanceQueryKey(apiBaseUrl),
    retry: 1,
    // A server awaiting its first account stops awaiting it when anyone signs up, here or on
    // the web, so that description is read again whenever a screen mounts or the app returns
    // to the foreground.
    staleTime: (query) => (query.state.data?.setupRequired === true ? 0 : Infinity),
  })
}

/** The instance query's key, for a screen that knows the description has changed. */
export function instanceQueryKey(apiBaseUrl: string | null): readonly unknown[] {
  return ['instance', apiBaseUrl]
}

/**
 * True only once the server has said the feature is on, the same rule as the web app's
 * `useConfirmedFeature`. For controls that fail when used on a server without the feature (a
 * sign-in button that would error): while the description loads, when it can't be fetched, and
 * when a server predates the field, the control stays hidden. Briefly hiding it on a server that
 * has it is the lesser harm.
 */
export function useConfirmedFeature(select: (features: Features) => boolean | undefined): boolean {
  const { data } = useInstance()
  return data ? select(data.features) === true : false
}

/** The server's single sign-on provider, once it has said it has one. */
export function useOidcProvider(): { name: string } | null {
  const { data } = useInstance()
  return data?.features.oidc ?? null
}

/**
 * Whether to offer passkeys: the server has them, its passkey hostname (`passkeyRpId`) is one of
 * this build's associated domains, and the device can use them (lib/auth/passkey-availability).
 * False while the description loads, on an older server and on any self-hosted server the build
 * wasn't made for.
 */
export function usePasskeyAvailable(): boolean {
  const { data } = useInstance()
  return isPasskeyAvailable({
    serverPasskey: data?.features.passkey,
    rpId: data?.features.passkeyRpId,
    appDomains: appPasskeyDomains(),
    deviceSupported: nativePasskeyAuthenticator.isSupported(),
  })
}

/**
 * Whether the server takes passwords. Off only once it has said so (`OIDC_ONLY`): while the
 * description loads, or on an older server, the password form stays.
 */
export function usePasswordSignIn(): boolean {
  const { data } = useInstance()
  return data?.features.passwordSignIn !== false
}

/**
 * Whether anyone may create an account on this server (`signupMode: 'open'`). False while the
 * description loads and for invite-only, closed or unknown modes, so a sign-up link that would
 * only be refused stays hidden.
 */
export function useSignupOpen(): boolean {
  const { data } = useInstance()
  return data?.signupMode === 'open'
}

/**
 * The server being set up, while it reports `setupRequired` (no account yet): its name and host,
 * for the "Set up this server" screen. Null while the description loads, when it can't be
 * fetched, on an older server without the field and on any server that already has accounts, so
 * the sign-in screen stays as it is in all of those.
 */
export function useServerSetup(): { host: string; name: string } | null {
  const apiBaseUrl = useServerSwitch()?.apiBaseUrl ?? null
  const { data } = useInstance()
  if (!data || data.setupRequired !== true || apiBaseUrl === null) return null
  return { host: hostOf(apiBaseUrl), name: data.name }
}

/**
 * The chains the server reads crypto wallets on (`features.cryptoWalletChains`). Empty while the
 * description loads, when it can't be fetched, on an older server and when the operator has not
 * configured an explorer: "Add crypto wallet" stays hidden then.
 */
export function useCryptoWalletChains(): readonly ('bitcoin' | 'ethereum')[] {
  const { data } = useInstance()
  return data?.features.cryptoWalletChains ?? NO_CHAINS
}

const NO_CHAINS: readonly ('bitcoin' | 'ethereum')[] = []

/**
 * Which build the connected server runs, for the More screen's version line. Null until the
 * description arrives, and on an older server that does not report a version.
 */
export function useServerBuildInfo(): { commit: string | null; version: string | null } {
  const { data } = useInstance()
  return { commit: data?.commit ?? null, version: data?.version ?? null }
}

/**
 * Whether the server has a shared Enable Banking credential (`features.bankSyncCredentials`).
 * Undefined while the description loads or when it can't be fetched.
 */
export function useInstanceBankSyncCredentials(): 'instance' | 'user' | undefined {
  const { data } = useInstance()
  return data ? (data.features.bankSyncCredentials ?? 'user') : undefined
}

export type EnableBankingSetupValues = NonNullable<InstanceDescription['enableBankingSetup']>

export type EnableBankingSetupState = Readonly<{
  /** The values to enter in the Control Panel, or null while they are not to hand. */
  values: EnableBankingSetupValues | null
  /** `missing`: the description arrived without them (an older server, or Enable Banking off). */
  status: 'loading' | 'failed' | 'missing' | 'ready'
  retry: () => void
}>

/**
 * The values to enter in Enable Banking's Control Panel for this server (its own redirect URL,
 * the privacy and terms URLs, a suggested name and description), and why they are not there yet.
 */
export function useEnableBankingSetup(): EnableBankingSetupState {
  const query = useInstance()
  const retry = () => { void query.refetch() }
  const values = query.data?.enableBankingSetup ?? null
  if (values) return { retry, status: 'ready', values }
  if (query.data) return { retry, status: 'missing', values: null }
  return { retry, status: query.isError ? 'failed' : 'loading', values: null }
}

type BankSyncCredentials = 'instance' | 'user'

/**
 * Whether the signed-in person can link a bank: with an active Enable Banking key of their own,
 * or when the server's shared credential covers their household (`bankSyncCredentials` on the
 * profile). Otherwise the connect screen asks for a key, added in the web app's Settings, and
 * says why when the server has a shared credential that serves another household.
 */
export type BankLinkCredentialState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { sharedUnavailable: boolean; status: 'credential-required' }

export type BankLinkCredentialInput = {
  /** This household's answer from the profile; undefined from an older server or on error. */
  callerCredentials: BankSyncCredentials | undefined
  callerLoading: boolean
  /** The server's answer from `GET /v1/instance`. */
  instanceCredentials: BankSyncCredentials | undefined
  ownCredentialActive: boolean
  ownCredentialLoading: boolean
}

export function resolveBankLinkCredential(input: BankLinkCredentialInput): BankLinkCredentialState {
  if (input.ownCredentialActive || input.callerCredentials === 'instance') return { status: 'ready' }
  if (input.ownCredentialLoading || input.callerLoading) return { status: 'loading' }
  return { sharedUnavailable: input.instanceCredentials === 'instance', status: 'credential-required' }
}

import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useProfile } from '@/features/self/use-self-resource'
import { useInstanceBankSyncCredentials } from '@/lib/server/use-instance'

import { type BankLinkCredentialState, resolveBankLinkCredential } from './bank-link-credential-policy'
import { enableBankingCredentialEndpoint } from './enable-banking-credential-contract'
import { enableBankingCredentialKey } from './query-keys'

/**
 * Whether the connect screen can list banks, or must ask for an Enable Banking key first
 * (`bank-link-credential-policy.ts`). A failed read of either answer reads as "no": the screen
 * asks for a key, as it would on a server without a shared credential.
 */
export function useBankLinkCredential(): BankLinkCredentialState {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBankLinkCredential requires an authenticated runtime')
  const profile = useProfile()
  const own = useQuery({
    queryKey: enableBankingCredentialKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(enableBankingCredentialEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const instanceCredentials = useInstanceBankSyncCredentials()
  return resolveBankLinkCredential({
    callerCredentials: profile.data?.profile.bankSyncCredentials,
    callerLoading: profile.isLoading,
    instanceCredentials,
    ownCredentialActive: own.data?.status === 'active',
    ownCredentialLoading: own.isLoading,
  })
}

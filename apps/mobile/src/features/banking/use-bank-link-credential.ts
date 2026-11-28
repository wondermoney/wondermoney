import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useProfile } from '@/features/self/use-self-resource'
import { useInstanceBankSyncCredentials } from '@/lib/server/use-instance'

import { type BankLinkCredentialState, resolveBankLinkCredential } from './bank-link-credential-policy'
import { useEnableBankingCredential } from './use-enable-banking-setup'

/**
 * Whether the connect screen can list banks, or must ask for an Enable Banking key first
 * (`bank-link-credential-policy.ts`), which the screen then sets up in the app. A failed read of either answer reads as "no": the screen
 * asks for a key, as it would on a server without a shared credential.
 */
export function useBankLinkCredential(): BankLinkCredentialState {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useBankLinkCredential requires an authenticated runtime')
  const profile = useProfile()
  const own = useEnableBankingCredential()
  const instanceCredentials = useInstanceBankSyncCredentials()
  return resolveBankLinkCredential({
    callerCredentials: profile.data?.profile.bankSyncCredentials,
    callerLoading: profile.isLoading,
    instanceCredentials,
    ownCredentialActive: own.data?.status === 'active',
    ownCredentialLoading: own.isLoading,
  })
}

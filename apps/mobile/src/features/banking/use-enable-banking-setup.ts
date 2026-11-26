import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  activateEnableBankingCredentialEndpoint,
  createEnableBankingCertificateEndpoint,
  type EnableBankingCertificate,
  enableBankingCredentialEndpoint,
} from './enable-banking-credential-contract'
import { enableBankingCredentialKey } from './query-keys'

/** The signed-in person's own Enable Banking key (`GET /v1/user/enable-banking-credential`), per session epoch. */
export function useEnableBankingCredential() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useEnableBankingCredential requires an authenticated runtime')
  return useQuery({
    queryKey: enableBankingCredentialKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(enableBankingCredentialEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/** A sensitive step's input: the authenticator code, when two-factor is on. */
export type SensitiveStepInput = Readonly<{ totpCode?: string }>

/** Re-reads the credential, so the setup and the connect screen see what the server now holds. */
export function useInvalidateEnableBankingCredential() {
  const { runtime } = useProductRuntime()
  const queryClient = useQueryClient()
  return () => runtime
    ? queryClient.invalidateQueries({ queryKey: enableBankingCredentialKey(runtime.epochId), exact: true })
    : Promise.resolve()
}

/**
 * Asks the server to generate a key pair and answers its certificate. The private key stays on
 * the server; the certificate is public, and lives only in the screen's state.
 */
export function useCreateEnableBankingCertificate() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useCreateEnableBankingCertificate requires an authenticated runtime')
  const invalidate = useInvalidateEnableBankingCredential()
  return useMutation({
    retry: false,
    networkMode: 'always',
    scope: { id: 'enable-banking-credential' },
    mutationFn: ({ totpCode }: SensitiveStepInput): Promise<EnableBankingCertificate> => (
      runtime.apiClient.write(createEnableBankingCertificateEndpoint, { commit: () => undefined, totpCode })
    ),
    onSuccess: () => invalidate(),
  })
}

/**
 * Activates the generated key under the application ID Enable Banking gave its certificate. On
 * success the answer goes into the cache before the re-read, so the credential reads active (and
 * the connect screen moves on to the bank list) even if the re-read fails.
 */
export function useActivateEnableBankingCredential() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useActivateEnableBankingCredential requires an authenticated runtime')
  const queryClient = useQueryClient()
  const invalidate = useInvalidateEnableBankingCredential()
  return useMutation({
    retry: false,
    networkMode: 'always',
    scope: { id: 'enable-banking-credential' },
    mutationFn: ({ applicationId, totpCode }: SensitiveStepInput & { applicationId: string }) => (
      runtime.apiClient.write(activateEnableBankingCredentialEndpoint, { body: { applicationId }, commit: () => undefined, totpCode })
    ),
    onSuccess: (credential) => {
      queryClient.setQueryData(enableBankingCredentialKey(runtime.epochId), credential)
      return invalidate()
    },
  })
}

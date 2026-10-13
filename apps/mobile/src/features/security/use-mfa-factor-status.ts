import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { mfaFactorsKey } from './query-keys'

export type MfaFactorStatusValue = Readonly<{
  hasVerifiedFactor: boolean
  verifiedFactorId: string | null
}>

/** Epoch-scoped read of whether the authenticated user has a verified TOTP factor. */
export function useMfaFactorStatus() {
  const { runtime, mfaListFactors } = useProductRuntime()
  if (!runtime) throw new Error('useMfaFactorStatus requires an authenticated runtime')

  return useQuery({
    queryKey: mfaFactorsKey(runtime.epochId),
    queryFn: async (): Promise<MfaFactorStatusValue> => {
      const result = await mfaListFactors()
      if (result.status !== 'available') throw new Error('mfa-factors-unavailable')
      const verified = result.totpFactors.find((factor) => factor.status === 'verified') ?? null
      return { hasVerifiedFactor: verified !== null, verifiedFactorId: verified?.id ?? null }
    },
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

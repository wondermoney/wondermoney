import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { MfaUnenrollOutcome } from '@/lib/auth/app-auth'

import { mfaFactorsKey } from './query-keys'

/**
 * Removes a TOTP factor while the user is still authenticated. This is the only
 * recovery path for a user who loses their authenticator device (matching web
 * parity) — there is no backup-code mechanism.
 */
export function useMfaUnenroll() {
  const { runtime, mfaUnenroll } = useProductRuntime()
  if (!runtime) throw new Error('useMfaUnenroll requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (factorId: string): Promise<MfaUnenrollOutcome> => {
      const outcome = await mfaUnenroll(factorId)
      if (outcome.status === 'unenrolled') {
        await queryClient.invalidateQueries({ queryKey: mfaFactorsKey(runtime.epochId), exact: true })
      }
      return outcome
    },
  })
}

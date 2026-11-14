import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { MfaUnenrollOutcome } from '@/lib/auth/app-auth'

import { mfaFactorsKey } from './query-keys'

/**
 * Removes a TOTP factor while the user is still authenticated. A user who has lost
 * their authenticator device signs in with one of the backup codes shown at enrolment
 * ("Use a backup code" on the second-factor screen), then turns two-factor off here
 * and on again with the new device, as on web.
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

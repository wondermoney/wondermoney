import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { profileKey } from '@/features/self/query-keys'
import { profileEndpoint } from '@/features/self/self-contracts'
import type { SendVerificationEmailOutcome } from '@/lib/auth/app-auth'

/**
 * Resends the better-auth verification link to the signed-in user's address. The address comes
 * from the profile resource (the same cache entry `useProfile` reads), resolved only when the
 * user asks, so screens that may never need it don't fetch it up front. A profile that cannot be
 * read is reported like any other failed send.
 */
export function useResendVerificationEmail() {
  const { runtime, sendVerificationEmail } = useProductRuntime()
  if (!runtime) throw new Error('useResendVerificationEmail requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (): Promise<SendVerificationEmailOutcome> => {
      let email: string
      try {
        const data = await queryClient.ensureQueryData({
          queryKey: profileKey(runtime.epochId),
          queryFn: () => runtime.apiClient.read(profileEndpoint),
        })
        email = data.profile.emailAddress
      } catch {
        return { status: 'unavailable' }
      }
      return sendVerificationEmail(email)
    },
  })
}

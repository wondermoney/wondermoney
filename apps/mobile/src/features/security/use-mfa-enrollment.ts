import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { MfaTotpEnrollOutcome, MfaVerifyOutcome } from '@/lib/auth/app-auth'

import { mfaFactorsKey } from './query-keys'

/**
 * TOTP enrollment as two guarded steps: `start` creates a new (unverified) factor and
 * returns its secret for manual entry into an authenticator app; `confirm` challenges
 * and verifies that same factor with the code the user typed. Neither the secret nor
 * the code is ever logged. On a verified confirmation the epoch-scoped factor-status
 * query is invalidated so Security reflects the new state.
 */
export function useMfaEnrollment() {
  const { runtime, mfaEnrollTotp, mfaChallenge, mfaVerify } = useProductRuntime()
  if (!runtime) throw new Error('useMfaEnrollment requires an authenticated runtime')
  const queryClient = useQueryClient()
  const pendingFactorId = useRef<string | null>(null)

  const start = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (): Promise<MfaTotpEnrollOutcome> => {
      const result = await mfaEnrollTotp()
      pendingFactorId.current = result.status === 'enrolled' ? result.factorId : null
      return result
    },
  })

  const confirm = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (code: string): Promise<MfaVerifyOutcome> => {
      const factorId = pendingFactorId.current
      if (!factorId) return { status: 'unavailable' }
      const challenge = await mfaChallenge(factorId)
      if (challenge.status !== 'challenged') return { status: 'unavailable' }
      const outcome = await mfaVerify(factorId, challenge.challengeId, code)
      if (outcome.status === 'verified') {
        pendingFactorId.current = null
        await queryClient.invalidateQueries({ queryKey: mfaFactorsKey(runtime.epochId), exact: true })
      }
      return outcome
    },
  })

  return { start, confirm }
}

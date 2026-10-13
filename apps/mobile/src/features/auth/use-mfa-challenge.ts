import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

export type MfaChallengeFailure = 'invalid-code' | 'unavailable'

/**
 * Drives the inline TOTP step-up shown on the `mfa-required` access-blocked screen:
 * finds the user's verified factor, challenges it, verifies the typed code, and — only
 * once Supabase confirms the code — resumes the runtime back to `authenticated`. The
 * code is never logged.
 */
export function useMfaChallenge() {
  const { mfaListFactors, mfaChallenge, mfaVerify, completeMfaVerification } = useProductRuntime()
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<MfaChallengeFailure | null>(null)

  const submit = async (code: string) => {
    if (submitting) return
    setSubmitting(true)
    setFailure(null)
    try {
      const factors = await mfaListFactors()
      const verifiedFactor = factors.status === 'available'
        ? factors.totpFactors.find((factor) => factor.status === 'verified')
        : undefined
      if (!verifiedFactor) {
        setFailure('unavailable')
        return
      }

      const challenge = await mfaChallenge(verifiedFactor.id)
      if (challenge.status !== 'challenged') {
        setFailure('unavailable')
        return
      }

      const outcome = await mfaVerify(verifiedFactor.id, challenge.challengeId, code)
      if (outcome.status === 'invalid-code') {
        setFailure('invalid-code')
        return
      }
      if (outcome.status !== 'verified') {
        setFailure('unavailable')
        return
      }

      await completeMfaVerification()
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, failure, submit }
}

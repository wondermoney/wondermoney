import { useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { MfaVerifyOutcome } from '@/lib/auth/app-auth'

export type MfaChallengeFailure = Exclude<MfaVerifyOutcome['status'], 'verified'>

/**
 * Drives the inline second-factor step shown on the `mfa-required` access-blocked screen:
 * an authenticator code (finds the user's verified factor, challenges it, verifies the typed
 * code) or one of the backup codes shown at enrolment. Only once the auth server confirms
 * the code does it resume the runtime back to `authenticated`. Codes are never logged or kept.
 */
export function useMfaChallenge() {
  const { mfaListFactors, mfaChallenge, mfaVerify, mfaVerifyBackupCode, completeMfaVerification } = useProductRuntime()
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<MfaChallengeFailure | null>(null)

  const run = async (verify: () => Promise<MfaVerifyOutcome>) => {
    if (submitting) return
    setSubmitting(true)
    setFailure(null)
    try {
      const outcome = await verify()
      if (outcome.status !== 'verified') {
        setFailure(outcome.status)
        return
      }
      await completeMfaVerification()
    } finally {
      setSubmitting(false)
    }
  }

  const verifyTotp = async (code: string): Promise<MfaVerifyOutcome> => {
    const factors = await mfaListFactors()
    const verifiedFactor = factors.status === 'available'
      ? factors.totpFactors.find((factor) => factor.status === 'verified')
      : undefined
    if (!verifiedFactor) return { status: 'unavailable' }

    const challenge = await mfaChallenge(verifiedFactor.id)
    if (challenge.status !== 'challenged') return { status: 'unavailable' }

    return mfaVerify(verifiedFactor.id, challenge.challengeId, code)
  }

  const submit = (code: string) => run(() => verifyTotp(code))
  const submitBackupCode = (code: string) => run(() => mfaVerifyBackupCode(code))

  return { submitting, failure, submit, submitBackupCode }
}

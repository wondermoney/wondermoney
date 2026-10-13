import { type Href, useNavigation, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppLock } from '@/components/providers/app-lock-provider'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useProfile } from '@/features/self/use-self-resource'

import type { AppLockFailure } from './app-lock-section'
import type { MfaSecuritySectionStatus } from './mfa-security-section'
import type { PasswordChangeFailure } from './password-change-section'
import { SecurityScreen } from './security-screen'
import { useChangePassword } from './use-change-password'
import { classifyDeleteAccountFailure, useDeleteAccount, type DeleteAccountFailure } from './use-delete-account'
import { useMfaEnrollment } from './use-mfa-enrollment'
import { useMfaFactorStatus } from './use-mfa-factor-status'
import { useMfaUnenroll } from './use-mfa-unenroll'

export function SecurityRoute() {
  const mutation = useDeleteAccount()
  const { signOut } = useProductRuntime()
  const router = useRouter()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const [outcome, setOutcome] = useState<DeleteAccountFailure | null>(null)

  const factorStatus = useMfaFactorStatus()
  const enrollment = useMfaEnrollment()
  const unenroll = useMfaUnenroll()

  const profile = useProfile()
  const changePassword = useChangePassword()
  const [passwordSucceeded, setPasswordSucceeded] = useState(false)

  const appLock = useAppLock()
  const [appLockPending, setAppLockPending] = useState(false)
  const [appLockFailure, setAppLockFailure] = useState<AppLockFailure | null>(null)

  // A deletion in flight must not be interrupted by a back gesture.
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (mutation.isPending) event.preventDefault()
  }), [mutation.isPending, navigation])

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/more' as unknown as Href)
  }

  const pendingEnrollment = enrollment.start.data?.status === 'enrolled' ? enrollment.start.data : null
  const mfaStatus: MfaSecuritySectionStatus = factorStatus.isLoading
    ? 'loading'
    : factorStatus.isError
      ? 'error'
      : pendingEnrollment
        ? 'enrolling'
        : factorStatus.data?.hasVerifiedFactor
          ? 'on'
          : 'off'

  return (
    <SecurityScreen
      pending={mutation.isPending}
      outcome={outcome}
      onBack={goBack}
      onDelete={async () => {
        setOutcome(null)
        try {
          await mutation.mutateAsync()
          // Success is 204. Only now do we retire the local session: this advances the
          // session generation, deactivates the authenticated UI, cancels in-flight
          // requests, and clears queries and sensitive local state before signing out.
          await signOut()
        } catch (error) {
          // The account remains intact; surface a specific, honest failure and keep the
          // user signed in. No partial local purge is performed.
          setOutcome(classifyDeleteAccountFailure(error))
        }
      }}
      mfa={{
        status: mfaStatus,
        enrollment: pendingEnrollment ? { secret: pendingEnrollment.totp.secret, uri: pendingEnrollment.totp.uri } : null,
        enrollBusy: enrollment.start.isPending,
        enrollFailed: enrollment.start.data?.status === 'unavailable',
        confirmBusy: enrollment.confirm.isPending,
        confirmFailure: enrollment.confirm.data?.status === 'invalid-code'
          ? 'invalid-code'
          : enrollment.confirm.data?.status === 'unavailable'
            ? 'unavailable'
            : null,
        unenrollBusy: unenroll.isPending,
        unenrollFailed: unenroll.data?.status === 'unavailable',
        onRetryStatus: () => { void factorStatus.refetch() },
        onTurnOn: () => enrollment.start.mutate(),
        onConfirm: async (code) => {
          const result = await enrollment.confirm.mutateAsync(code)
          // The pending factor is now verified server-side; drop the local secret so the
          // section falls back to the freshly-invalidated (now enabled) factor status.
          if (result.status === 'verified') enrollment.start.reset()
        },
        onCancelEnrollment: () => {
          enrollment.start.reset()
          enrollment.confirm.reset()
        },
        onTurnOff: () => {
          const factorId = factorStatus.data?.verifiedFactorId
          if (factorId) unenroll.mutate(factorId)
        },
      }}
      password={{
        pending: changePassword.isPending,
        succeeded: passwordSucceeded,
        failure: changePassword.data?.status === 'updated' ? null : (changePassword.data?.status ?? null) as PasswordChangeFailure | null,
        onSubmit: async (currentPassword, newPassword) => {
          setPasswordSucceeded(false)
          const email = profile.data?.profile.emailAddress
          if (!email) return
          const result = await changePassword.mutateAsync({ email, currentPassword, newPassword })
          if (result.status === 'updated') setPasswordSucceeded(true)
        },
      }}
      appLock={{
        isLoaded: appLock.isLoaded,
        enabled: appLock.enabled,
        pending: appLockPending,
        failure: appLockFailure,
        onTurnOn: async () => {
          setAppLockPending(true)
          setAppLockFailure(null)
          const result = await appLock.setEnabled(true, t('security.appLock.confirmPrompt'))
          setAppLockPending(false)
          if (result.status === 'unavailable') setAppLockFailure(result.capability)
          else if (result.status === 'auth-failed') setAppLockFailure('auth-failed')
        },
        onTurnOff: async () => {
          setAppLockPending(true)
          setAppLockFailure(null)
          await appLock.setEnabled(false, t('security.appLock.confirmPrompt'))
          setAppLockPending(false)
        },
      }}
    />
  )
}

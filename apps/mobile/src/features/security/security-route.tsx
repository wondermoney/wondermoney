import * as Linking from 'expo-linking'
import { type Href, usePreventRemove, useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppLock } from '@/components/providers/app-lock-provider'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useProfile } from '@/features/self/use-self-resource'
import { useConfirmedFeature, usePasskeyAvailable } from '@/lib/server/use-instance'

import type { AppLockFailure } from './app-lock-section'
import type { DataExportFailure } from './data-export-section'
import type { PasskeysNotice } from './passkeys-section'
import type { MfaSecuritySectionStatus } from './mfa-security-section'
import type { PasswordChangeFailure } from './password-change-section'
import { SecurityScreen } from './security-screen'
import { useChangePassword } from './use-change-password'
import { classifyDataExportFailure, isDataExportPreparing, useLatestDataExport, useStartDataExport } from './use-data-export'
import { classifyDeleteAccountFailure, useDeleteAccount, type DeleteAccountFailure } from './use-delete-account'
import { useMfaEnrollment } from './use-mfa-enrollment'
import { useMfaFactorStatus } from './use-mfa-factor-status'
import { useMfaUnenroll } from './use-mfa-unenroll'
import { useAddPasskey, useDeletePasskey, usePasskeys } from './use-passkeys'

export function SecurityRoute() {
  const mutation = useDeleteAccount()
  const { signOut } = useProductRuntime()
  const router = useRouter()
  const { t, i18n } = useTranslation()
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

  // Exports are offered where the server stores them; without storage they are made on the web.
  const exportsStored = useConfirmedFeature((features) => features.fileStorage)
  const latestExport = useLatestDataExport(exportsStored)
  const startExport = useStartDataExport()
  const [exportFailure, setExportFailure] = useState<DataExportFailure | null>(null)
  const latest = latestExport.data ?? null
  const exportReady = latest?.status === 'ready' && latest.downloadUrl !== null

  // Passkeys are listed wherever the server has them; one can be added only where the phone will
  // hand this app the server's passkeys (its hostname is in the build's associated domains).
  const serverPasskeys = useConfirmedFeature((features) => features.passkey)
  const canAddPasskey = usePasskeyAvailable()
  const passkeys = usePasskeys({ enabled: serverPasskeys })
  const addPasskey = useAddPasskey()
  const deletePasskey = useDeletePasskey()
  const [passkeyNotice, setPasskeyNotice] = useState<PasskeysNotice | null>(null)

  // A deletion in flight must not be interrupted by a back gesture.
  usePreventRemove(mutation.isPending)

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
      passkeys={serverPasskeys ? {
        status: passkeys.isLoading ? 'loading' : passkeys.isError ? 'error' : 'ready',
        passkeys: passkeys.data ?? [],
        canAdd: canAddPasskey,
        adding: addPasskey.isPending,
        deletingId: deletePasskey.isPending ? (deletePasskey.variables ?? null) : null,
        notice: passkeyNotice,
        locale: i18n.language,
        onRetry: () => { void passkeys.refetch() },
        onAdd: async () => {
          setPasskeyNotice(null)
          const result = await addPasskey.mutateAsync()
          if (result.status === 'added') setPasskeyNotice('added')
          else if (result.status === 'session-not-fresh') setPasskeyNotice('session-not-fresh')
          else if (result.status === 'unavailable') setPasskeyNotice('add-failed')
          // A closed prompt says nothing.
        },
        onDelete: async (id) => {
          setPasskeyNotice(null)
          const result = await deletePasskey.mutateAsync(id)
          setPasskeyNotice(result.status === 'deleted' ? 'deleted' : 'delete-failed')
        },
      } : null}
      mfa={{
        status: mfaStatus,
        enrollment: pendingEnrollment
          ? { secret: pendingEnrollment.totp.secret, uri: pendingEnrollment.totp.uri, backupCodes: pendingEnrollment.backupCodes }
          : null,
        enrollBusy: enrollment.start.isPending,
        enrollFailed: enrollment.start.data?.status === 'unavailable',
        confirmBusy: enrollment.confirm.isPending,
        confirmFailure: enrollment.confirm.data?.status === 'invalid-code'
          ? 'invalid-code'
          : enrollment.confirm.data && enrollment.confirm.data.status !== 'verified'
            ? 'unavailable'
            : null,
        unenrollBusy: unenroll.isPending,
        unenrollFailed: unenroll.data?.status === 'unavailable',
        onRetryStatus: () => { void factorStatus.refetch() },
        onTurnOn: () => enrollment.start.mutate(),
        onConfirm: async (code) => {
          const result = await enrollment.confirm.mutateAsync(code)
          // The pending factor is now verified server-side; drop the local secret and backup
          // codes so the section falls back to the freshly-invalidated (now enabled) factor status.
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
      dataExport={{
        available: exportsStored,
        status: isDataExportPreparing(latest) ? 'preparing' : exportReady ? 'ready' : latest?.status === 'failed' ? 'failed' : 'idle',
        readyUntil: exportReady && latest.expiresAt ? new Date(latest.expiresAt).toLocaleString(i18n.language) : null,
        protectedExport: latest?.encrypted === true,
        starting: startExport.isPending,
        failure: exportFailure,
        onStart: async (password) => {
          setExportFailure(null)
          try {
            await startExport.mutateAsync(password === undefined ? {} : { password })
            return true
          } catch (error) {
            setExportFailure(classifyDataExportFailure(error))
            return false
          }
        },
        onDownload: () => {
          // A short-lived link to the stored file that needs no sign-in; the browser downloads it.
          if (latest?.downloadUrl) void Linking.openURL(latest.downloadUrl)
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

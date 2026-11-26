import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { requestReturnAfterSignIn } from '@/lib/auth/return-after-sign-in'
import { useEnableBankingSetup } from '@/lib/server/use-instance'

import { copyText, openControlPanel, readClipboardText, shareCertificate } from './enable-banking-setup-device'
import { EnableBankingSetupScreen } from './enable-banking-setup-screen'
import {
  classifyEnableBankingSetupFailure,
  type EnableBankingSetupFailure,
  enableBankingControlPanelValues,
  failureAsksForCode,
  initialEnableBankingSetupStep,
  pendingCertificateExpiry,
} from './enable-banking-setup-view-model'
import { useActivateEnableBankingCredential, useCreateEnableBankingCertificate, useEnableBankingCredential } from './use-enable-banking-setup'

/** Where signing in again comes back to: the connect screen, which shows this setup again. */
const SETUP_HREF = '/more/banking/connect'

export type EnableBankingSetupRouteProps = Readonly<{
  sharedUnavailable: boolean
  onBack: () => void
  /** The key is active: the connect screen moves on to the bank list. */
  onActivated: () => void
}>

/**
 * The connect screen's setup for a person without a usable Enable Banking key. It resumes from
 * the server's pending credential, sends the authenticator code when the server asks for it, and
 * signs out for a fresh session when the server wants one, coming back here afterwards.
 */
export function EnableBankingSetupRoute({ sharedUnavailable, onBack, onActivated }: EnableBankingSetupRouteProps) {
  const { t } = useTranslation()
  const { signOut } = useProductRuntime()
  const credential = useEnableBankingCredential()
  const setup = useEnableBankingSetup()
  const createCertificate = useCreateEnableBankingCertificate()
  const activate = useActivateEnableBankingCredential()
  const [failure, setFailure] = useState<EnableBankingSetupFailure | null>(null)
  const [askForCode, setAskForCode] = useState(false)

  // The resume point is read once the credential has loaded; the screen keeps its own step after.
  if (credential.isLoading) return null

  const certificatePem = createCertificate.data?.certificatePem ?? null

  const fail = (error: unknown) => {
    const classified = classifyEnableBankingSetupFailure(error)
    if (failureAsksForCode(classified.reason)) setAskForCode(true)
    setFailure(classified)
  }

  return (
    <EnableBankingSetupScreen
      initialStep={initialEnableBankingSetupStep(credential.data ?? undefined)}
      sharedUnavailable={sharedUnavailable}
      values={enableBankingControlPanelValues(setup)}
      certificatePem={certificatePem}
      pendingExpiresAt={certificatePem ? null : pendingCertificateExpiry(credential.data ?? undefined)}
      creatingCertificate={createCertificate.isPending}
      activating={activate.isPending}
      failure={failure}
      askForCode={askForCode}
      onBack={onBack}
      onOpenUrl={(url) => { void openControlPanel(url) }}
      onCreateCertificate={(totpCode) => {
        setFailure(null)
        createCertificate.mutate({ totpCode }, { onError: fail })
      }}
      onActivate={(applicationId, totpCode) => {
        setFailure(null)
        activate.mutate({ applicationId, totpCode }, { onSuccess: onActivated, onError: fail })
      }}
      onCopy={copyText}
      onShareCertificate={() => (certificatePem ? shareCertificate(certificatePem, t('banking.keySetup.create.shareTitle')) : Promise.resolve(false))}
      onReadClipboard={readClipboardText}
      onSignInAgain={() => {
        requestReturnAfterSignIn(SETUP_HREF)
        void signOut()
      }}
    />
  )
}

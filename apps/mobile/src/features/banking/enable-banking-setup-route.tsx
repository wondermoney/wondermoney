import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { canAddBankKey } from '@/features/household/household-permissions'
import { useHouseholdMembers } from '@/features/household/use-household-members'
import { requestReturnAfterSignIn } from '@/lib/auth/return-after-sign-in'
import { useEnableBankingSetup } from '@/lib/server/use-instance'

import { copyText, openControlPanel, readClipboardText, shareCertificate } from './enable-banking-setup-device'
import { EnableBankingSetupScreen, type EnableBankingSetupGate } from './enable-banking-setup-screen'
import {
  classifyEnableBankingSetupFailure,
  type EnableBankingSetupFailure,
  enableBankingControlPanelValues,
  failureAsksForCode,
  failureNeedsNewCertificate,
  initialEnableBankingSetupStep,
  pendingCertificateExpiry,
  sessionTooOldForSetup,
} from './enable-banking-setup-view-model'
import {
  useActivateEnableBankingCredential,
  useCreateEnableBankingCertificate,
  useEnableBankingCredential,
  useInvalidateEnableBankingCredential,
} from './use-enable-banking-setup'

export type EnableBankingSetupRouteProps = Readonly<{
  sharedUnavailable: boolean
  onBack: () => void
  /** The key is active: the connect screen moves on to the bank list. */
  onActivated: () => void
}>

/**
 * The connect screen's setup for a person without a usable Enable Banking key. Before any step it
 * checks what would stop the person later: a household viewer can't add a key, and a session too
 * old for the server's sensitive actions is renewed first. It resumes from the server's pending
 * credential, sends the authenticator code when the server asks for it, and on a stale session
 * signs out and comes back here afterwards.
 */
export function EnableBankingSetupRoute({ sharedUnavailable, onBack, onActivated }: EnableBankingSetupRouteProps) {
  const { t } = useTranslation()
  const { runtime, signOut, sessionStartedAt } = useProductRuntime()
  const server = useServerSwitch()?.apiBaseUrl ?? null
  const credential = useEnableBankingCredential()
  const setup = useEnableBankingSetup()
  const household = useHouseholdMembers()
  const createCertificate = useCreateEnableBankingCertificate()
  const activate = useActivateEnableBankingCredential()
  const invalidateCredential = useInvalidateEnableBankingCredential()
  const [failure, setFailure] = useState<EnableBankingSetupFailure | null>(null)
  const [askForCode, setAskForCode] = useState(false)
  const session = useQuery({
    queryKey: ['session-started-at', runtime?.epochId ?? 0],
    queryFn: () => sessionStartedAt(),
    retry: false,
    staleTime: Infinity,
  })

  // The resume point and the gate are read once both are known; the screen keeps its own step after.
  if (credential.isLoading || session.isLoading) return null

  const certificatePem = createCertificate.data?.certificatePem ?? null

  const gate: EnableBankingSetupGate = !canAddBankKey(household.viewerRole)
    ? 'read-only'
    : sessionTooOldForSetup(session.data ?? null) ? 'sign-in-again' : 'steps'

  const fail = (error: unknown) => {
    const classified = classifyEnableBankingSetupFailure(error)
    if (failureAsksForCode(classified.reason)) setAskForCode(true)
    if (failureNeedsNewCertificate(classified.reason)) {
      // The certificate made earlier is gone on the server: forget it here too, and re-read the
      // credential, so step 2 offers "Create certificate" again.
      createCertificate.reset()
      void invalidateCredential()
    }
    setFailure(classified)
  }

  return (
    <EnableBankingSetupScreen
      gate={gate}
      initialStep={initialEnableBankingSetupStep(credential.data ?? undefined)}
      sharedUnavailable={sharedUnavailable}
      values={enableBankingControlPanelValues(setup.values)}
      valuesStatus={setup.status}
      onRetryValues={setup.retry}
      certificatePem={certificatePem}
      pendingExpiresAt={certificatePem ? null : pendingCertificateExpiry(credential.data ?? undefined)}
      creatingCertificate={createCertificate.isPending}
      activating={activate.isPending}
      failure={failure}
      askForCode={askForCode}
      onBack={onBack}
      onOpenUrl={openControlPanel}
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
        // Back to the connect screen, which shows this setup again, for this person on this server.
        if (runtime && server) requestReturnAfterSignIn({ href: '/more/banking/connect', principalId: runtime.principalId, server })
        void signOut()
      }}
    />
  )
}

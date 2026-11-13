import * as DocumentPicker from 'expo-document-picker'
import { type Href, usePreventRemove, useRouter } from 'expo-router'

import { canWriteAccount } from '@/features/accounts/account-access'
import { mapAccounts } from '@/features/accounts/accounts-view-model'
import { useAccounts } from '@/features/accounts/use-accounts'
import { useResendVerificationEmail } from '@/features/auth/use-resend-verification-email'

import { OCR_UPLOAD_MIME_TYPES } from './transaction-ocr-contract'
import { TransactionOcrScreen, type VerificationResendStatus } from './transaction-ocr-screen'
import { useManualTransactionMetadata } from './use-manual-transaction-metadata'
import { useTransactionOcr } from './use-transaction-ocr'

const BLOCKING_PHASES = new Set(['scanning', 'confirming'])

export function TransactionOcrRoute() {
  const accountsQuery = useAccounts()
  const metadata = useManualTransactionMetadata('')
  const ocr = useTransactionOcr()
  const router = useRouter()
  const resendVerification = useResendVerificationEmail()

  usePreventRemove(BLOCKING_PHASES.has(ocr.state.phase))

  // A receipt is added to an account the caller can edit, never one they can only view (#95).
  const accounts = accountsQuery.data ? mapAccounts(accountsQuery.data).filter(canWriteAccount) : []
  const types = metadata.types.data?.transactionTypes ?? []
  const currencies = metadata.currencies.data?.currencies ?? []
  const metadataLoading = accountsQuery.isLoading || metadata.types.isLoading || metadata.currencies.isLoading

  let verificationResend: VerificationResendStatus = 'idle'
  if (resendVerification.isPending) verificationResend = 'sending'
  else if (resendVerification.data?.status === 'sent') verificationResend = 'sent'
  else if (resendVerification.data || resendVerification.isError) verificationResend = 'failed'

  const back = () => router.replace('/accounts' as Href)

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: [...OCR_UPLOAD_MIME_TYPES] })
    const picked = result.canceled ? null : result.assets[0]
    if (!picked) return
    await ocr.scan({ uri: picked.uri, name: picked.name, mimeType: picked.mimeType ?? 'application/octet-stream' })
  }

  return (
    <TransactionOcrScreen
      state={ocr.state}
      accounts={accounts}
      types={types}
      currencies={currencies}
      metadataLoading={metadataLoading}
      onPickFile={pickFile}
      onConfirm={ocr.confirm}
      onReject={() => { void ocr.reject() }}
      onReset={() => {
        resendVerification.reset()
        ocr.reset()
      }}
      onBack={back}
      verificationResend={verificationResend}
      onResendVerification={() => resendVerification.mutate()}
    />
  )
}

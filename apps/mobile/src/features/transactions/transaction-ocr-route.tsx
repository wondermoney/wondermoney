import * as DocumentPicker from 'expo-document-picker'
import { type Href, useNavigation, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { mapAccounts } from '@/features/accounts/accounts-view-model'
import { useAccounts } from '@/features/accounts/use-accounts'

import { OCR_UPLOAD_MIME_TYPES } from './transaction-ocr-contract'
import { TransactionOcrScreen } from './transaction-ocr-screen'
import { useManualTransactionMetadata } from './use-manual-transaction-metadata'
import { useTransactionOcr } from './use-transaction-ocr'

const BLOCKING_PHASES = new Set(['scanning', 'confirming'])

export function TransactionOcrRoute() {
  const accountsQuery = useAccounts()
  const metadata = useManualTransactionMetadata('')
  const ocr = useTransactionOcr()
  const router = useRouter()
  const navigation = useNavigation()

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (BLOCKING_PHASES.has(ocr.state.phase)) event.preventDefault()
  }), [navigation, ocr.state.phase])

  const accounts = accountsQuery.data ? mapAccounts(accountsQuery.data) : []
  const types = metadata.types.data?.transactionTypes ?? []
  const currencies = metadata.currencies.data?.currencies ?? []
  const metadataLoading = accountsQuery.isLoading || metadata.types.isLoading || metadata.currencies.isLoading

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
      onReset={ocr.reset}
      onBack={back}
    />
  )
}

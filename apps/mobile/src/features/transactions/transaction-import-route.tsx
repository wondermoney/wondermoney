import * as DocumentPicker from 'expo-document-picker'
import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseAccountId } from '@/features/accounts/accounts-contract'
import { mapAccounts } from '@/features/accounts/accounts-view-model'
import { useAccounts } from '@/features/accounts/use-accounts'

import { TransactionImportScreen } from './transaction-import-screen'
import { useTransactionImport } from './use-transaction-import'

const IMPORT_MIME_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const BLOCKING_PHASES = new Set(['uploading', 'starting', 'processing'])

export function TransactionImportRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const initialAccountId = parseAccountId(params.accountId)
  const accountsQuery = useAccounts()
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(initialAccountId)
  const importState = useTransactionImport()
  const router = useRouter()
  const navigation = useNavigation()
  const { t } = useTranslation()

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (BLOCKING_PHASES.has(importState.state.phase)) event.preventDefault()
  }), [importState.state.phase, navigation])

  const accounts = accountsQuery.data
    ? mapAccounts(accountsQuery.data).map((account) => ({ id: account.accountId, name: account.accountName ?? t('accounts.unnamed') }))
    : []

  const back = () => router.replace('/accounts' as Href)

  const pickFile = async () => {
    if (selectedAccountId === null) return
    const result = await DocumentPicker.getDocumentAsync({ type: IMPORT_MIME_TYPES })
    const picked = result.canceled ? null : result.assets[0]
    if (!picked) return
    await importState.start(selectedAccountId, { uri: picked.uri, name: picked.name })
  }

  return (
    <TransactionImportScreen
      state={importState.state}
      accounts={accounts}
      accountsLoading={accountsQuery.isLoading}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      onPickFile={pickFile}
      onReset={importState.reset}
      onBack={back}
    />
  )
}

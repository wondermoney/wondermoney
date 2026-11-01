import * as DocumentPicker from 'expo-document-picker'
import { type Href, useNavigation, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { useAccounts } from '@/features/accounts/use-accounts'
import { ApiError } from '@/lib/api/errors'

import { StatementImportScreen, type StatementImportAccountsState } from './statement-import-screen'
import { useStatementImport } from './use-statement-import'

const IMPORT_MIME_TYPES = ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel']
const BLOCKING_PHASES = new Set(['uploading', 'processing'])

/**
 * General "Import a statement" entry point, reachable from a
 * failed connection row on the Connections screen. The connection-status
 * DTO deliberately does not expose which account(s) belong to a
 * connection, so this route cannot pre-select one; the user
 * picks from their full account list instead, same as the account picker
 * already used on GoalDetailScreen's AccountContextEditor.
 */
export function StatementImportRoute() {
  const router = useRouter()
  const navigation = useNavigation()
  const accounts = useAccounts()
  const importState = useStatementImport()
  const [selectedAccountId, setSelectedAccountId] = useState<null | number>(null)

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (BLOCKING_PHASES.has(importState.state.phase)) event.preventDefault()
  }), [importState.state.phase, navigation])

  const back = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/more/banking' as Href)
  }

  const accountsState: StatementImportAccountsState = accounts.data ? {
    status: 'loaded',
    accounts: accounts.data.accounts
      .filter((account) => Number.isSafeInteger(account.accountKey) && account.accountKey > 0)
      .map((account) => ({ accountId: account.accountKey, name: account.accountName })),
  } : accounts.isLoading ? { status: 'loading' } : {
    status: accounts.error instanceof ApiError && accounts.error.code === 'invalid-response' ? 'invalid-response' : 'error',
  }

  const pickFile = async () => {
    if (selectedAccountId === null) return
    const result = await DocumentPicker.getDocumentAsync({ type: IMPORT_MIME_TYPES })
    const picked = result.canceled ? null : result.assets[0]
    if (!picked) return
    await importState.start(selectedAccountId, { uri: picked.uri, name: picked.name })
  }

  return (
    <StatementImportScreen
      accountsState={accountsState}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      onRetryAccounts={() => { void accounts.refetch() }}
      state={importState.state}
      onPickFile={pickFile}
      onReset={importState.reset}
      onBack={back}
    />
  )
}

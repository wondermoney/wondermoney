import { useQuery } from '@tanstack/react-query'
import * as DocumentPicker from 'expo-document-picker'
import { type Href, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseAccountId } from '@/features/accounts/accounts-contract'
import { mapAccounts } from '@/features/accounts/accounts-view-model'
import { useAccounts } from '@/features/accounts/use-accounts'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { shareReportCsv } from '@/features/reports/report-csv-export'

import { buildGenericCsvTemplate, GENERIC_CSV_TEMPLATE_FILENAME, importFlowForAccount } from './generic-csv-format'
import { transactionTypesEndpoint } from './manual-transaction-contract'
import { formatManualTransactionType } from './manual-transaction-types'
import { type TemplateShareStatus, TransactionImportScreen } from './transaction-import-screen'
import { transactionTypesKey } from './use-manual-transaction-metadata'
import { useTransactionImport } from './use-transaction-import'

const IMPORT_MIME_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/x-ofx',
  'application/ofx',
  'application/vnd.intu.qfx',
  'application/qif',
  'application/x-qif',
  'application/xml',
  'text/xml',
  'application/octet-stream',
]
// The generic format reads CSV, and the API reads OFX/QFX and QIF by their own adapters. Some
// Android providers label a .csv as text/plain, so that is accepted too; the import hook still
// checks the file name before uploading.
const GENERIC_MIME_TYPES = ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/x-ofx', 'application/ofx', 'application/vnd.intu.qfx', 'application/qif', 'application/x-qif', 'application/xml', 'text/xml', 'application/octet-stream']
const BLOCKING_PHASES = new Set(['uploading', 'starting', 'processing'])

export function TransactionImportRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const initialAccountId = parseAccountId(params.accountId)
  const accountsQuery = useAccounts()
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(initialAccountId)
  const importState = useTransactionImport()
  const router = useRouter()
  const { t } = useTranslation()
  const { runtime } = useProductRuntime()
  const [templateStatus, setTemplateStatus] = useState<TemplateShareStatus>('idle')

  usePreventRemove(BLOCKING_PHASES.has(importState.state.phase))

  const accountModels = accountsQuery.data ? mapAccounts(accountsQuery.data) : []
  const accounts = accountModels.map((account) => ({ id: account.accountId, name: account.accountName ?? t('accounts.unnamed') }))
  const selectedAccount = accountModels.find((account) => account.accountId === selectedAccountId) ?? null
  const flow = selectedAccount ? importFlowForAccount(selectedAccount.csvImportFormat) : null

  // The instance's type codes, for the generic format's code list and the template's example rows.
  const typesQuery = useQuery({
    queryKey: transactionTypesKey(runtime?.epochId ?? 0),
    queryFn: () => {
      if (!runtime) throw new Error('TransactionImportRoute requires an authenticated runtime')
      return runtime.apiClient.read(transactionTypesEndpoint)
    },
    enabled: flow === 'generic' && !!runtime,
    retry: false,
  })
  const transactionTypes = typesQuery.data?.transactionTypes ?? []
  const typeCodes = transactionTypes.map((type) => ({ code: type.transactionTypeKey, label: formatManualTransactionType(t, type.name) }))

  const shareTemplate = async () => {
    setTemplateStatus('sharing')
    try {
      await shareReportCsv(buildGenericCsvTemplate(transactionTypes), GENERIC_CSV_TEMPLATE_FILENAME)
      setTemplateStatus('idle')
    } catch {
      setTemplateStatus('error')
    }
  }

  const back = () => router.replace('/accounts' as Href)

  const pickFile = async () => {
    if (selectedAccountId === null || flow === 'unknown') return
    const result = await DocumentPicker.getDocumentAsync({ type: flow === 'generic' ? GENERIC_MIME_TYPES : IMPORT_MIME_TYPES })
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
      flow={flow}
      bankName={selectedAccount?.institutionDisplayName ?? null}
      typeCodes={typeCodes}
      templateStatus={templateStatus}
      onShareTemplate={shareTemplate}
      onSelectAccount={(accountId) => { setSelectedAccountId(accountId); setTemplateStatus('idle') }}
      onPickFile={pickFile}
      onReset={importState.reset}
      onBack={back}
    />
  )
}

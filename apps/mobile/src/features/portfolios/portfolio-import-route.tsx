import * as DocumentPicker from 'expo-document-picker'
import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useColorScheme } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { PortfolioFailure } from './portfolio-screen-parts'
import { PortfolioImportScreen } from './portfolio-import-screen'
import { parsePortfolioId } from './portfolios-contract'
import { usePortfolioImport } from './use-portfolio-import'

const IMPORT_MIME_TYPES = ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel']
const BLOCKING_PHASES = new Set(['uploading', 'parsing', 'mapping', 'confirming'])

export function PortfolioImportRoute() {
  const params = useLocalSearchParams<{ portfolioId?: string | string[] }>()
  const portfolioId = parsePortfolioId(params.portfolioId)
  const router = useRouter()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const importState = usePortfolioImport(portfolioId ?? 1)

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (BLOCKING_PHASES.has(importState.state.phase) || importState.resolvingAssetGroups) event.preventDefault()
  }), [importState.resolvingAssetGroups, importState.state.phase, navigation])

  const back = () => {
    if (portfolioId === null) { router.replace('/portfolio' as Href); return }
    router.replace({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } } as Href)
  }

  if (portfolioId === null) {
    return (
      <PortfolioFailure
        title={t('portfolioImport.states.invalidIdTitle')}
        message={t('portfolioImport.states.invalidIdMessage')}
        retryLabel={t('common.retry')}
        signOutLabel={t('common.signOut')}
        backLabel={t('portfolioImport.back')}
        onRetry={async () => back()}
        onSignOut={async () => undefined}
        onBack={back}
        canRetry={false}
        palette={palette}
      />
    )
  }

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: IMPORT_MIME_TYPES })
    const picked = result.canceled ? null : result.assets[0]
    if (!picked) return
    await importState.start({ uri: picked.uri, name: picked.name })
  }

  return (
    <PortfolioImportScreen
      state={importState.state}
      onPickFile={pickFile}
      onConfirm={importState.confirm}
      onReset={importState.reset}
      onBack={back}
      onResolveAssetGroups={importState.resolveAssetGroups}
      resolvingAssetGroups={importState.resolvingAssetGroups}
      palette={palette}
    />
  )
}

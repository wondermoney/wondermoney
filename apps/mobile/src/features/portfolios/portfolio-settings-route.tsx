import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useColorScheme } from 'react-native'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { themeTokens } from '@/theme/tokens'

import { PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import { reconcilePortfolioSettings, type PortfolioSettingsReconciliation } from './portfolio-settings-reconciliation'
import { PortfolioSettingsScreen } from './portfolio-settings-screen'
import { parsePortfolioId, type PortfolioResponseDto, type PortfolioSettingsWrite } from './portfolios-contract'
import { classifyPortfolioSettingsFailure, usePortfolioSettings, type PortfolioSettingsFailure } from './use-portfolio-settings'
import { usePortfolioMetadata } from './use-portfolio-metadata'

export function PortfolioSettingsRoute() {
  const params = useLocalSearchParams<{ portfolioId?: string | string[] }>()
  const portfolioId = parsePortfolioId(params.portfolioId)
  const detail = usePortfolioMetadata(portfolioId)
  const mutation = usePortfolioSettings(portfolioId ?? 1)
  const router = useRouter()
  const navigation = useNavigation()
  const { signOut } = useProductRuntime()
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const navigationUnlocked = useRef(false)
  const autoReconciledPayload = useRef<Readonly<PortfolioSettingsWrite> | null>(null)
  const [fallbackPortfolio, setFallbackPortfolio] = useState<PortfolioResponseDto['portfolio'] | null>(() => detail.data?.portfolio.portfolioKey === portfolioId ? detail.data.portfolio : null)
  const [failure, setFailure] = useState<PortfolioSettingsFailure | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconciliation, setReconciliation] = useState<PortfolioSettingsReconciliation | null>(null)

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (mutation.isPending && !navigationUnlocked.current) event.preventDefault()
  }), [mutation.isPending, navigation])

  const back = () => {
    navigationUnlocked.current = true
    if (portfolioId === null) router.replace('/portfolio' as Href)
    else router.replace({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } } as Href)
  }

  const reconcile = async () => {
    const retained = mutation.unknownOutcome?.payload
    if (reconciling || portfolioId === null || !retained) return
    setReconciling(true)
    setReconciliation(null)
    try {
      const result = await detail.refetch()
      if (result.error || !result.data) throw result.error ?? new Error('Portfolio detail was unavailable')
      const outcome = reconcilePortfolioSettings(portfolioId, retained, result.data)
      setReconciliation(outcome)
      if (outcome === 'applied') {
        mutation.acknowledgeReconciliation('applied')
        setFailure(null)
      }
    } catch {
      setReconciliation('uncertain')
    } finally {
      setReconciling(false)
    }
  }

  useEffect(() => {
    const retained = mutation.unknownOutcome?.payload ?? null
    if (!retained) {
      autoReconciledPayload.current = null
      return
    }
    if (autoReconciledPayload.current === retained) return
    autoReconciledPayload.current = retained
    void reconcile()
  })

  if (detail.isAccessTransition) return null
  const detailMismatched = detail.data !== undefined && detail.data.portfolio.portfolioKey !== portfolioId
  const portfolio = detail.data && !detailMismatched
    ? detail.data.portfolio
    : mutation.unknownOutcome ? fallbackPortfolio : null
  if (detail.isInvalidId || (!portfolio && (detail.isNotFound || detail.isInvalidResponse || detailMismatched || (!detail.data && detail.error)))) {
    const key = detail.isInvalidId ? 'invalidId' : detail.isNotFound ? 'notFound' : detail.isInvalidResponse || detailMismatched ? 'invalidResponse' : 'error'
    return <PortfolioFailure title={t(`portfolioSettings.states.${key}Title`)} message={t(`portfolioSettings.states.${key}Message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('portfolioSettings.back')} onRetry={detail.refetch} onSignOut={signOut} onBack={back} canRetry={!detail.isInvalidId && !detail.isNotFound} palette={palette} />
  }
  if (!portfolio) return <PortfolioLoading label={t('portfolioSettings.states.loadingTitle')} palette={palette} onBack={back} backLabel={t('portfolioSettings.back')} />

  return (
    <PortfolioSettingsScreen
      key={`${portfolio.name}:${portfolio.description ?? ''}:${portfolio.benchmarkSymbol ?? ''}:${portfolio.excluded ?? false}:${portfolio.favored ?? false}:${JSON.stringify(portfolio.targetAllocation ?? null)}:${mutation.unknownOutcome ? 'unknown' : 'authoritative'}`}
      model={{ id: portfolio.portfolioKey, name: portfolio.name, description: portfolio.description ?? null, currency: portfolio.currencyKey.code, benchmarkSymbol: portfolio.benchmarkSymbol ?? null, excluded: portfolio.excluded ?? false, favored: portfolio.favored ?? false, targetAllocation: portfolio.targetAllocation ?? null }}
      pending={mutation.isPending}
      failure={failure}
      unknownPayload={mutation.unknownOutcome?.payload ?? null}
      reconciling={reconciling}
      reconciliation={reconciliation}
      onBack={back}
      onReconcile={reconcile}
      onAcknowledgeReconciliation={() => {
        if (reconciliation !== 'not-applied') return
        mutation.acknowledgeReconciliation('not-applied')
        setReconciliation(null)
        setFailure(null)
      }}
      onDismissApplied={() => setReconciliation(null)}
      onSave={async (value: PortfolioSettingsWrite) => {
        setFallbackPortfolio(portfolio)
        setFailure(null)
        setReconciliation(null)
        try {
          const response = await mutation.mutateAsync(value)
          if (response.portfolio.portfolioKey !== portfolio.portfolioKey) throw new Error('Mismatched portfolio detail')
          navigationUnlocked.current = true
          router.replace({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolio.portfolioKey) } } as Href)
        } catch (error) {
          setFailure(classifyPortfolioSettingsFailure(error))
        }
      }}
    />
  )
}

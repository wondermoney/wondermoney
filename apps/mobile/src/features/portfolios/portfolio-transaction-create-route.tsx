import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useColorScheme } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { PortfolioFailure } from './portfolio-screen-parts'
import { PortfolioTransactionCreateScreen, type PortfolioTransactionCreateDraftState } from './portfolio-transaction-create-screen'
import { isManuallyCreatableTransactionType, parsePortfolioId } from './portfolios-contract'
import { classifyCreatePortfolioTransactionFailure, useCreatePortfolioTransaction, type CreatePortfolioTransactionFailure } from './use-create-portfolio-transaction'
import { usePortfolioCurrencies } from './use-portfolio-currencies'
import { usePortfolioMetadata } from './use-portfolio-metadata'
import { usePortfolioTransactionTypes } from './use-portfolio-transaction-types'

export function PortfolioTransactionCreateRoute() {
  const params = useLocalSearchParams<{ portfolioId?: string | string[] }>()
  const portfolioId = parsePortfolioId(params.portfolioId)
  const router = useRouter()
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const metadata = usePortfolioMetadata(portfolioId)
  const currencies = usePortfolioCurrencies()
  const transactionTypes = usePortfolioTransactionTypes()
  const create = useCreatePortfolioTransaction(portfolioId ?? 1)
  const [outcome, setOutcome] = useState<CreatePortfolioTransactionFailure | null>(null)

  const back = () => {
    if (portfolioId === null) { router.replace('/portfolio' as Href); return }
    router.replace({ pathname: '/portfolio/[portfolioId]/activity', params: { portfolioId: String(portfolioId) } } as Href)
  }

  if (portfolioId === null) {
    return (
      <PortfolioFailure
        title={t('portfolioTransactionCreate.states.invalidIdTitle')}
        message={t('portfolioTransactionCreate.states.invalidIdMessage')}
        retryLabel={t('common.retry')}
        signOutLabel={t('common.signOut')}
        backLabel={t('portfolioTransactionCreate.back')}
        onRetry={async () => back()}
        onSignOut={async () => undefined}
        onBack={back}
        canRetry={false}
        palette={palette}
      />
    )
  }

  const loading = currencies.isPending || transactionTypes.isPending || metadata.isPending
  const metadataError = !loading && (!currencies.data || !transactionTypes.data)
  const selectableTypes = (transactionTypes.data?.transactionTypes ?? []).filter((type) => isManuallyCreatableTransactionType(type.name))
  const portfolioCurrencyCode = metadata.data?.portfolio.currencyKey.code
  const defaultCurrencyId = currencies.data?.currencies.find((currency) => currency.code === portfolioCurrencyCode)?.currencyKey ?? null

  return (
    <PortfolioTransactionCreateScreen
      transactionTypes={selectableTypes}
      currencies={currencies.data?.currencies ?? []}
      defaultCurrencyId={defaultCurrencyId}
      loading={loading}
      metadataError={metadataError}
      pending={create.isPending}
      outcome={outcome}
      palette={palette}
      onBack={back}
      onCreate={async (draft: PortfolioTransactionCreateDraftState) => {
        setOutcome(null)
        try {
          await create.mutateAsync(draft)
          back()
        } catch (error) {
          setOutcome(classifyCreatePortfolioTransactionFailure(error))
        }
      }}
    />
  )
}

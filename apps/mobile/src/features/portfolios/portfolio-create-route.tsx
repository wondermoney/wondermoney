import { useQueryClient } from '@tanstack/react-query'
import { type Href, useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import type { AccountsResponseDto } from '@/features/accounts/accounts-contract'
import { accountsKey } from '@/features/accounts/query-keys'
import { ApiError } from '@/lib/api/errors'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { selectPortfolioDefaultCurrency } from './portfolio-create-default'
import { PortfolioButton } from './portfolio-form-parts'
import { PortfolioCreateScreen } from './portfolio-create-screen'
import { createPortfolioEndpoint, portfoliosEndpoint, type AggregateDashboardResponseDto, type PortfolioCreateWrite } from './portfolios-contract'
import { aggregatePortfolioDashboardKey, portfolioKey, portfoliosKey } from './query-keys'
import { classifyPortfolioCreateFailure, useCreatePortfolio, type PortfolioCreateFailure } from './use-create-portfolio'
import { usePortfolioCurrencies } from './use-portfolio-currencies'

export function PortfolioCreateRoute() {
  const { runtime } = useProductRuntime(); if (!runtime) throw new Error('PortfolioCreateRoute requires an authenticated runtime')
  const currencies = usePortfolioCurrencies(); const create = useCreatePortfolio(); const queryClient = useQueryClient(); const router = useRouter(); const navigation = useNavigation()
  const submissionLock = useRef(false); const navigationLock = useRef(false); const navigationUnlocked = useRef(false); const detailLock = useRef(false); const didNavigate = useRef(false); const unknownRefreshAttempted = useRef(false); const confirmedPayload = useRef<Readonly<PortfolioCreateWrite> | null>(null)
  const [failure, setFailure] = useState<PortfolioCreateFailure | null>(null); const [confirmedPortfolioId, setConfirmedPortfolioId] = useState<number | null>(null); const [detailState, setDetailState] = useState<'idle' | 'loading' | 'unavailable'>('idle'); const [refreshingList, setRefreshingList] = useState(false); const [listRefreshFailed, setListRefreshFailed] = useState(false)
  useEffect(() => navigation.addListener('beforeRemove', (event) => { if ((navigationLock.current || create.isPending) && !navigationUnlocked.current) event.preventDefault() }), [create.isPending, navigation])
  const refreshList = async () => { if (refreshingList) return; setRefreshingList(true); setListRefreshFailed(false); try { await queryClient.invalidateQueries({ queryKey: portfoliosKey(runtime.epochId), exact: true, refetchType: 'all' }); await queryClient.fetchQuery({ queryKey: portfoliosKey(runtime.epochId), queryFn: () => runtime.apiClient.read(portfoliosEndpoint), staleTime: 0 }) } catch { setListRefreshFailed(true) } finally { setRefreshingList(false) } }
  useEffect(() => { if (!create.unknownOutcome || unknownRefreshAttempted.current) return; unknownRefreshAttempted.current = true; void refreshList() })
  const loadCanonicalDetail = async (portfolioId: number, payload: Readonly<PortfolioCreateWrite>) => { if (detailLock.current || didNavigate.current) return; detailLock.current = true; navigationLock.current = true; setDetailState('loading'); try { const response = await queryClient.fetchQuery({ queryKey: portfolioKey(runtime.epochId, portfolioId), queryFn: () => runtime.apiClient.read(createPortfolioEndpoint(portfolioId)), staleTime: 0 }); const expectedCurrency = currencies.data?.currencies.find((currency) => currency.currencyKey === payload.currencyId); if (response.portfolio.portfolioKey !== portfolioId || response.portfolio.name !== payload.name || !expectedCurrency || response.portfolio.currencyKey.code !== expectedCurrency.code) throw new ApiError('invalid-response'); didNavigate.current = true; navigationUnlocked.current = true; router.replace({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: String(portfolioId) } } as Href) } catch { navigationLock.current = false; setDetailState('unavailable') } finally { detailLock.current = false } }
  const submit = async (payload: PortfolioCreateWrite) => { if (submissionLock.current || create.isPending || create.unknownOutcome) return; submissionLock.current = true; navigationLock.current = true; confirmedPayload.current = payload; setFailure(null); try { const response = await create.mutateAsync(payload); setConfirmedPortfolioId(response.portfolioId); await loadCanonicalDetail(response.portfolioId, payload) } catch (error) { navigationLock.current = false; const kind = classifyPortfolioCreateFailure(error); setFailure(kind); if (kind !== 'unknown') { submissionLock.current = false; confirmedPayload.current = null } else await refreshList() } }
  const back = () => { navigationUnlocked.current = true; router.replace('/portfolio' as Href) }
  if (currencies.isAccessTransition) return null
  if (!currencies.data && !create.unknownOutcome) {
    const state = currencies.isPending ? 'loading' : currencies.isInvalidResponse ? 'invalid' : 'error'
    return <PortfolioCreateScreenState state={state} onBack={back} onRetry={async () => { await currencies.refetch() }} />
  }
  const dashboard = queryClient.getQueryData<AggregateDashboardResponseDto>(aggregatePortfolioDashboardKey(runtime.epochId)); const accounts = queryClient.getQueryData<AccountsResponseDto>(accountsKey(runtime.epochId)); const accountCode = accounts?.accounts.map((account) => account.accountOwnerAppuserKey.currencyKey.code).find((code, index, values) => values.every((value) => value === code))
  const values = currencies.data?.currencies ?? []; const defaultCurrencyId = selectPortfolioDefaultCurrency(values, dashboard?.summary.currency, accountCode)
  return <PortfolioCreateScreen currencies={values} defaultCurrencyId={defaultCurrencyId} pending={create.isPending || detailState === 'loading'} unknownPayload={create.unknownOutcome?.payload ?? null} failure={failure} detailState={detailState} confirmedPortfolioId={confirmedPortfolioId} refreshingList={refreshingList} listRefreshFailed={listRefreshFailed} onBack={back} onSubmit={submit} onRefreshList={refreshList} onRetryDetail={async () => { if (confirmedPortfolioId !== null && confirmedPayload.current) await loadCanonicalDetail(confirmedPortfolioId, confirmedPayload.current) }} />
}

function PortfolioCreateScreenState({ state, onBack, onRetry }: { state: 'loading' | 'invalid' | 'error'; onBack: () => void; onRetry: () => Promise<void> }) { const { t } = useTranslation(); const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']; return <SafeAreaView style={[stateStyles.safe, { backgroundColor: palette.background }]}><View style={stateStyles.center}><Text accessibilityRole="header" style={[stateStyles.title, { color: palette.foreground }]}>{t(`portfolioCreate.options.${state}Title`)}</Text>{state !== 'loading' ? <Text accessibilityRole="alert" style={[stateStyles.copy, { color: palette.mutedForeground }]}>{t(`portfolioCreate.options.${state}Message`)}</Text> : null}{state !== 'loading' ? <PortfolioButton label={t('common.retry')} onPress={onRetry} palette={palette} /> : null}<BackControl fallback="/portfolio" label={t('portfolioCreate.back')} onPress={onBack} /></View></SafeAreaView> }
const stateStyles = StyleSheet.create({ safe: { flex: 1 }, center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', gap: themeTokens.spacing[4], padding: themeTokens.layout.screenPadding }, title: { ...textStyles.title }, copy: { ...textStyles.body } })

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert as NativeAlert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Amount, MISSING } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { Alert, Failure, Header, Loading } from '@/features/loans/loans-screen'
import { NetWorthChart } from '@/features/net-worth/net-worth-chart'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { currencyList, kindGlyph } from './assets-screen'
import { CryptoWalletManage, CryptoWalletSection, type CryptoWalletActions } from './crypto-wallet-section'
import type { ManualAssetDto, ManualAssetResponse } from './manual-assets-contract'
import { changeSincePurchase, formatDay, isEstimated, monthlyChartPoints, shownValue } from './manual-assets-view-model'
import type { ManualAssetWriteFailure } from './use-manual-asset-writes'

type Outcome = Promise<ManualAssetWriteFailure | null>

/** What a hand-valued asset's page can change on it; each write resolves with why it failed, or null. */
export type ManualAssetManageActions = Readonly<{
  /** A write is in flight: the controls wait. */
  pending: boolean
  /** Opens Edit asset. */
  onEdit: () => void
  /** Archive (once confirmed) or Bring back. */
  onSetArchived: (archived: boolean) => Outcome
  /** Delete, once confirmed; on success the route leaves the page. */
  onDelete: () => Outcome
}>

export type AssetDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: ManualAssetResponse; refreshing?: boolean }
  | { status: 'refresh-error'; data: ManualAssetResponse; refreshing?: boolean }

/**
 * Web's asset page (`assets/[assetId]/asset-detail-client.tsx`) at phone width: "← Assets"; the
 * asset's mark, name and kind; today's value as the headline figure (and in the viewer's currency
 * when it is in another one); Update value as the one control; the value over time; the
 * valuations, newest first; then the details, with Archive (or Bring back) and Delete under them.
 * Edit sits beside Update value, as on the web; correcting or removing a valuation stays on the web.
 *
 * A crypto wallet is valued by its daily sync, not by hand: it has no Update value and no list of
 * valuations, and shows its addresses and tokens (`CryptoWalletSection`) instead.
 */
export function AssetDetailScreen({ state, onBack, onUpdateValue, onRefresh, wallet: walletActions, manage }: {
  state: AssetDetailViewState
  onBack: () => void
  onUpdateValue: () => void
  onRefresh: () => void | Promise<void>
  /** A crypto wallet's writes; without them its section is read-only. */
  wallet?: CryptoWalletActions
  /** Edit, archive and delete for a hand-valued asset; without them the page offers none. */
  manage?: ManualAssetManageActions
}) {
  const { t, i18n } = useTranslation()
  const formatMoney = useFormatMoney()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('manualAssetDetail.loading')} />
  if (state.status !== 'loaded' && state.status !== 'refresh-error') {
    const key = state.status === 'invalid-response' ? 'invalid' : state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : 'error'
    return <Failure title={t(`manualAssetDetail.${key}Title`)} message={t(`manualAssetDetail.${key}Message`)} onRetry={state.status === 'invalid-id' || state.status === 'not-found' ? undefined : onRefresh} onBack={onBack} fallback="/assets" backLabel={t('manualAssetDetail.back')} />
  }
  const { asset, valuations, history, wallet } = state.data
  const isWallet = asset.kind === 'crypto_wallet'
  const money = (value: number) => formatMoney(value, { locale, currency: asset.currency })
  const value = shownValue(asset)
  const foreign = asset.currency !== asset.userCurrency
  const noRate = !asset.archived && foreign && asset.value !== null && asset.valueInUserCurrency === null
  const change = changeSincePurchase(asset)
  const percent = (ratio: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(ratio)
  const points = monthlyChartPoints(history)
  const status = asset.archivedAt
    ? { label: t('manualAssetDetail.archivedOn', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(asset.archivedAt)) }) }
    : isEstimated(asset) && asset.lastValuation
      ? { label: t('manualAssetDetail.estimated', { date: formatDay(asset.lastValuation.date, locale) }) }
      : undefined
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <View style={styles.header}>
            <Header
              title={asset.name}
              descriptor={t(`manualAssets.kinds.${asset.kind}`)}
              badge={asset.isPrivate ? <Badge label={t('manualAssets.private')} tone="muted" /> : undefined}
              fallback="/assets"
              backLabel={t('manualAssetDetail.back')}
              onBack={onBack}
              leading={<EntityMark glyph={kindGlyph(asset.kind)} />}
              figure={(
                <HeadlineFigure
                  currency={asset.currency}
                  label={asset.archived ? t('manualAssetDetail.lastValue') : t('manualAssetDetail.valueToday')}
                  locale={locale}
                  secondary={foreign && asset.valueInUserCurrency !== null ? { value: asset.valueInUserCurrency, currency: asset.userCurrency } : null}
                  size="md"
                  status={status}
                  testID="asset-value"
                  value={value}
                />
              )}
            />
            {noRate ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t('manualAssets.unconverted', { count: 1, currencies: currencyList([asset.currency], locale) })}</Text> : null}
            {state.status === 'refresh-error' ? <Alert label={t('manualAssetDetail.stale')} /> : null}
            {isWallet && asset.value === null && !asset.archived ? <Text tone="muted" variant="meta">{t('cryptoWallet.detail.notValuedYet')}</Text> : null}
            {!isWallet && (!asset.archived || manage) ? (
              <View style={styles.actions}>
                {!asset.archived ? <Button icon="refresh-cw" label={t('manualAssetDetail.updateValue')} onPress={onUpdateValue} /> : null}
                {manage ? <Button disabled={manage.pending} icon="pencil" label={t('manualAssetDetail.manage.edit')} onPress={manage.onEdit} variant="outline" /> : null}
              </View>
            ) : null}
          </View>

          {isWallet && wallet ? (
            <CryptoWalletSection
              actions={walletActions ?? READ_ONLY_WALLET}
              readOnly={asset.archived || walletActions === undefined}
              wallet={wallet}
            />
          ) : null}

          {asset.linkedLoans.length > 0 ? <AssetEquity asset={asset} locale={locale} /> : null}

          {points.length > 1 ? (
            <Section title={t('manualAssetDetail.historyTitle')} variant="open">
              <NetWorthChart
                accessibilityLabel={t('manualAssetDetail.chartLabel', { from: formatDay(points[0].date, locale), to: formatDay(points[points.length - 1].date, locale) })}
                currency={asset.currency}
                locale={locale}
                points={points}
              />
            </Section>
          ) : null}

          {!isWallet ? <Section title={t('manualAssetDetail.valuationsTitle')} variant="open" testID="asset-valuations">
            <View>
              {valuations.map((valuation, index) => (
                <ListRow
                  key={valuation.manualAssetValuationKey}
                  accessibilityLabel={[formatDay(valuation.date, locale), money(valuation.value), valuation.note].filter(Boolean).join(', ')}
                  figure={<Amount currency={asset.currency} locale={locale} size="amountBase" value={valuation.value} />}
                  meta={[valuation.note]}
                  separated={index > 0}
                  title={formatDay(valuation.date, locale)}
                />
              ))}
            </View>
          </Section> : null}

          <Section title={t('manualAssetDetail.facts.title')} variant="open" testID="asset-facts">
            <View>
              <Fact first label={t('manualAssetDetail.facts.kind')} value={t(`manualAssets.kinds.${asset.kind}`)} />
              {asset.purchasePrice !== null || asset.purchaseDate !== null ? (
                <Fact
                  label={t('manualAssetDetail.facts.purchased')}
                  value={asset.purchasePrice !== null && asset.purchaseDate !== null
                    ? t('manualAssetDetail.facts.purchasedValue', { amount: money(asset.purchasePrice), date: formatDay(asset.purchaseDate, locale) })
                    : asset.purchasePrice !== null ? money(asset.purchasePrice) : formatDay(asset.purchaseDate!, locale)}
                />
              ) : null}
              {change ? (
                <Fact
                  label={t('manualAssetDetail.facts.changeSincePurchase')}
                  // A sign, not only a colour.
                  value={[`${change.amount > 0 ? '+' : ''}${money(change.amount)}`, change.ratio === null ? null : percent(change.ratio)].filter(Boolean).join(' · ')}
                />
              ) : null}
              {asset.growthRule ? (
                <Fact
                  label={t('manualAssetDetail.facts.growth')}
                  value={asset.growthRule.startDate
                    ? t('manualAssetDetail.facts.growthFrom', { rate: percent(asset.growthRule.annualRatePercent / 100), date: formatDay(asset.growthRule.startDate, locale) })
                    : percent(asset.growthRule.annualRatePercent / 100)}
                />
              ) : null}
              <Fact label={t('manualAssetDetail.facts.visibility')} value={asset.isPrivate ? t('manualAssetDetail.facts.private') : t('manualAssetDetail.facts.shared')} />
              {!asset.isOwner && asset.ownerFirstName ? <Fact label={t('manualAssetDetail.facts.owner')} value={asset.ownerFirstName} /> : null}
              {asset.notes ? <Fact label={t('manualAssetDetail.facts.notes')} value={asset.notes} /> : null}
            </View>
            {isWallet && walletActions && !asset.archived ? <CryptoWalletManage actions={walletActions} asset={asset} /> : null}
            {!isWallet && manage ? <AssetManage actions={manage} archived={asset.archived} /> : null}
            <Text style={styles.webNote} tone="muted" variant="meta">{t(isWallet ? 'cryptoWallet.detail.manageOnWeb' : 'manualAssetDetail.valuationsOnWeb')}</Text>
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * Web's `AssetEquity`: what the asset is worth less what is still owed on the loans secured
 * against it, all in the asset's currency, then those loans in their own. A loan the API has no
 * rate for leaves no total and no equity (`—`), and the note says why rather than adding amounts
 * in different currencies. A negative equity keeps its minus sign and gets the "Underwater" note,
 * so it never rests on colour.
 */
function AssetEquity({ asset, locale }: { asset: ManualAssetDto; locale: string }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const money = (value: number | null, currency = asset.currency) => value === null ? MISSING : formatMoney(value, { locale, currency })
  const unconverted = asset.unconvertedLoanCurrencies.length > 0
    ? asset.unconvertedLoanCurrencies
    : [...new Set(asset.linkedLoans.filter((loan) => loan.outstandingPrincipalInAssetCurrency === null).map((loan) => loan.currency))].sort()
  const note = asset.linkedDebt === null
    ? t('manualAssetDetail.equity.noRate', { currencies: currencyList(unconverted, locale), currency: asset.currency })
    : asset.value === null
      ? t('manualAssetDetail.equity.archived')
      : asset.equity !== null && asset.equity < 0 ? t('manualAssetDetail.equity.underwater') : null
  return (
    <Section title={t('manualAssetDetail.equity.title')} variant="open" testID="asset-equity">
      <View>
        <Fact first figure label={t('manualAssetDetail.equity.value')} value={money(asset.value)} />
        <Fact figure label={t('manualAssetDetail.equity.linkedDebt')} value={money(asset.linkedDebt)} />
        <Fact figure label={t('manualAssetDetail.equity.equity')} value={money(asset.equity)} />
      </View>
      {note ? <Text accessibilityRole={asset.linkedDebt === null ? 'alert' : undefined} style={styles.equityNote} tone="muted" variant="meta">{note}</Text> : null}
      <Text accessibilityRole="header" style={styles.loansHead} variant="action">{t('manualAssetDetail.equity.loans')}</Text>
      <View testID="asset-equity-loans">
        {asset.linkedLoans.map((loan, index) => (
          <Fact
            key={loan.loanKey}
            first={index === 0}
            figure
            label={loan.name}
            value={money(loan.outstandingPrincipal, loan.currency)}
            detail={loan.currency !== asset.currency && loan.outstandingPrincipalInAssetCurrency !== null
              ? t('manualAssetDetail.equity.converted', { amount: money(loan.outstandingPrincipalInAssetCurrency) })
              : undefined}
          />
        ))}
      </View>
    </Section>
  )
}

const confirm = (title: string, message: string, cancel: string, proceed: string, destructive: boolean) => new Promise<boolean>((resolve) => {
  NativeAlert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

/**
 * Web's Archive / Bring back and Delete asset, under the details. Archiving asks first (it stops
 * counting in net worth from today; the history stays); bringing it back does not. Deleting asks
 * first, with web's warning, and cannot be undone.
 */
function AssetManage({ actions, archived }: { actions: ManualAssetManageActions; archived: boolean }) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ManualAssetWriteFailure | null>(null)
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null)
  const run = async (which: 'archive' | 'delete', write: () => Outcome) => {
    setFailure(null)
    setBusy(which)
    try {
      setFailure(await write())
    } finally {
      setBusy(null)
    }
  }
  const archive = async () => {
    if (actions.pending) return
    if (archived) return run('archive', () => actions.onSetArchived(false))
    const confirmed = await confirm(t('manualAssetDetail.manage.archiveTitle'), t('manualAssetDetail.manage.archiveMessage'), t('common.cancel'), t('manualAssetDetail.manage.archive'), false)
    if (confirmed) await run('archive', () => actions.onSetArchived(true))
  }
  const remove = async () => {
    if (actions.pending) return
    const confirmed = await confirm(t('manualAssetDetail.manage.deleteTitle'), t('manualAssetDetail.manage.deleteMessage'), t('common.cancel'), t('manualAssetDetail.manage.delete'), true)
    if (confirmed) await run('delete', actions.onDelete)
  }
  return (
    <View style={styles.manage} testID="asset-manage">
      <View style={styles.actions}>
        <Button disabled={actions.pending} icon="archive" label={archived ? t('manualAssetDetail.manage.unarchive') : t('manualAssetDetail.manage.archive')} loading={busy === 'archive'} onPress={archive} variant="outline" />
        <Button disabled={actions.pending} icon="trash" label={t('manualAssetDetail.manage.delete')} loading={busy === 'delete'} onPress={remove} variant="destructive-quiet" />
      </View>
      {failure ? <Notice message={t(`manualAssets.failures.${failure}`)} tone="destructive" testID="asset-manage-failure" /> : null}
    </View>
  )
}

const noWrite = async () => null
const READ_ONLY_WALLET: CryptoWalletActions = {
  chains: [],
  pending: false,
  onToggleToken: noWrite,
  onAddAddress: noWrite,
  onSetLabel: noWrite,
  onRemoveAddress: noWrite,
  onSyncNow: noWrite,
  onUpdateWallet: noWrite,
  onDeleteWallet: noWrite,
}

function Fact({ label, value, detail, figure = false, first = false }: { label: string; value: string; detail?: string; figure?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={[label, value, detail].filter(Boolean).join(', ')} style={[styles.fact, { borderBottomColor: palette.border }, first && styles.firstFact]}>
      <Text style={styles.factLabel} tone="muted" variant="meta">{label}</Text>
      <View style={styles.factValue}>
        <Text style={styles.factValueText} variant={figure ? 'amount' : 'meta'}>{value}</Text>
        {detail ? <Text style={styles.factValueText} tone="muted" variant="label">{detail}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  header: { gap: themeTokens.spacing[4] },
  actions: { flexDirection: 'row', gap: themeTokens.spacing[2] },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], borderBottomWidth: StyleSheet.hairlineWidth },
  firstFact: { paddingTop: 0 },
  factLabel: { flexShrink: 0 },
  factValue: { flexShrink: 1, alignItems: 'flex-end' },
  factValueText: { textAlign: 'right' },
  equityNote: { marginTop: themeTokens.spacing[3] },
  loansHead: { marginTop: themeTokens.spacing[6], marginBottom: themeTokens.spacing[1] },
  webNote: { marginTop: themeTokens.spacing[4] },
  manage: { gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[4] },
})

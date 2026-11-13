import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import type { IconName } from '@/components/ui/icon'
import { List, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { Alert, Failure, Loading } from '@/features/loans/loans-screen'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { AssetKind, ManualAssetDto, ManualAssetsResponse } from './manual-assets-contract'
import { formatDay, shownValue, splitAssets } from './manual-assets-view-model'

export type AssetsViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: ManualAssetsResponse; refreshing?: boolean }
  | { status: 'refresh-error'; data: ManualAssetsResponse; refreshing?: boolean }

const KIND_GLYPHS: Record<AssetKind, IconName> = { property: 'home', vehicle: 'car', valuable: 'gem', other: 'layers', crypto_wallet: 'coins' }

export const kindGlyph = (kind: AssetKind): IconName => KIND_GLYPHS[kind]

/** "GBP and USD", or a plain list where the engine lacks Intl.ListFormat. */
export function currencyList(currencies: readonly string[], locale: string): string {
  try {
    if (typeof Intl.ListFormat === 'function') return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(currencies)
  } catch {
    // An unsupported locale falls through to the plain list.
  }
  return currencies.join(', ')
}

/**
 * Web's Assets page (`assets/assets-client.tsx`) at phone width: title and description, the total
 * in the viewer's currency (with what it leaves out for want of a rate), the assets that count
 * today, then the archived ones. Adding an asset is the floating "+"; "Add crypto wallet" sits
 * under the total, only on a server that reads wallets (`onCreateWallet` given).
 */
export function AssetsScreen({ state, onOpenAsset, onCreateAsset, onCreateWallet, onRefresh }: {
  state: AssetsViewState
  onOpenAsset: (assetId: number) => void
  onCreateAsset: () => void
  /** Absent when the server has no crypto wallet chain enabled: the entry is hidden then. */
  onCreateWallet?: () => void
  onRefresh: () => void | Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('manualAssets.loading')} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    const key = state.status === 'invalid-response' ? 'invalid' : 'error'
    return <Failure title={t(`manualAssets.${key}Title`)} message={t(`manualAssets.${key}Message`)} onRetry={onRefresh} />
  }
  const { assets, summary } = state.data
  const { active, archived } = splitAssets(assets)
  const empty = assets.length === 0
  return (
    <View style={styles.safeArea}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <ScrollView contentContainerStyle={[styles.content, !empty && styles.contentUnderButton]} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
          <View style={styles.page}>
            {state.status === 'refresh-error' ? <Alert label={t('manualAssets.stale')} /> : null}
            {empty ? (
              <View style={styles.empty}>
                <Text accessibilityRole="header" variant="section">{t('manualAssets.emptyTitle')}</Text>
                <Text tone="muted" variant="meta">{t('manualAssets.emptyMessage')}</Text>
                <Button icon="plus" label={t('manualAssets.add')} onPress={onCreateAsset} style={styles.hug} />
                {onCreateWallet ? <Button icon="coins" label={t('cryptoWallet.add')} onPress={onCreateWallet} style={styles.hug} testID="assets-add-wallet" variant="outline" /> : null}
              </View>
            ) : (
              <>
                <PageHeader title={t('manualAssets.title')} description={t('manualAssets.description')} />
                <View style={styles.summary} testID="assets-summary">
                  <HeadlineFigure currency={summary.currencyCode} label={t('manualAssets.total')} locale={locale} value={summary.totalValue} />
                  {/* A partial total never reads as a whole one. */}
                  {!summary.isComplete ? (
                    <Text accessibilityRole="alert" tone="muted" variant="meta">
                      {t('manualAssets.unconverted', { count: summary.unconvertedAssets, currencies: currencyList(summary.unconvertedCurrencies, locale) })}
                    </Text>
                  ) : null}
                  {onCreateWallet ? <Button icon="coins" label={t('cryptoWallet.add')} onPress={onCreateWallet} style={styles.hug} testID="assets-add-wallet" variant="outline" /> : null}
                </View>
                {active.length > 0 ? (
                  <List>
                    {active.map((asset, index) => <AssetRow key={asset.manualAssetKey} asset={asset} locale={locale} userCurrency={summary.currencyCode} separated={index > 0} onPress={() => onOpenAsset(asset.manualAssetKey)} />)}
                  </List>
                ) : null}
                {archived.length > 0 ? (
                  <Section title={t('manualAssets.archivedTitle')} aside={t('manualAssets.archivedDescription')} variant="open" testID="assets-archived">
                    <List>
                      {archived.map((asset, index) => <AssetRow key={asset.manualAssetKey} asset={asset} locale={locale} userCurrency={summary.currencyCode} separated={index > 0} onPress={() => onOpenAsset(asset.manualAssetKey)} />)}
                    </List>
                  </Section>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      {/* The empty state's own "Add asset" is the one add there. */}
      {!empty ? <FloatingActionButton accessibilityLabel={t('manualAssets.add')} onPress={onCreateAsset} testID="assets-add" /> : null}
    </View>
  )
}

/**
 * One asset: its kind and when it was last valued, its value in its own currency and, when that
 * is another currency, the API's converted value (or that there is no rate) beneath.
 */
function AssetRow({ asset, locale, userCurrency, separated, onPress }: { asset: ManualAssetDto; locale: string; userCurrency: string; separated: boolean; onPress: () => void }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const value = shownValue(asset)
  const foreign = asset.currency !== userCurrency
  // A wallet before its first sync has no value yet, so nothing to convert.
  const converted = foreign && !asset.archived && asset.value !== null
    ? (asset.valueInUserCurrency === null ? t('manualAssets.noRate') : formatMoney(asset.valueInUserCurrency, { locale, currency: userCurrency }))
    : null
  const lastValued = asset.lastValuation
    ? t('manualAssets.lastValued', { date: formatDay(asset.lastValuation.date, locale) })
    // A new wallet has no value until its first sync.
    : asset.kind === 'crypto_wallet' && !asset.archived ? t('cryptoWallet.notValuedYet') : null
  const label = [
    asset.name,
    t(`manualAssets.kinds.${asset.kind}`),
    asset.isPrivate ? t('manualAssets.private') : null,
    value === null ? null : `${formatMoney(value, { locale, currency: asset.currency })}, ${asset.currency}`,
    converted,
    lastValued,
  ].filter(Boolean).join(', ')
  return (
    <ListRow
      accessibilityLabel={label}
      badge={asset.isPrivate ? <Badge label={t('manualAssets.private')} tone="muted" /> : undefined}
      density="comfortable"
      figure={value === null ? undefined : <Amount currency={asset.currency} locale={locale} size="amountBase" value={value} />}
      figureMeta={converted ? <Text tone="muted" variant="meta">{converted}</Text> : undefined}
      leading={<EntityMark glyph={kindGlyph(asset.kind)} />}
      meta={[t(`manualAssets.kinds.${asset.kind}`), lastValued]}
      onPress={onPress}
      separated={separated}
      title={asset.name}
    />
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  summary: { gap: themeTokens.spacing[2] },
  empty: { gap: themeTokens.spacing[3] },
  hug: { alignSelf: 'flex-start' },
})

import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { List, ListRow } from '@/components/ui/list-row'
import { ObjectHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Stat, StatList, StatValue } from '@/components/ui/stat'
import { Text as UiText } from '@/components/ui/text'
import { formatPercentagePoints } from '@/lib/formatters/financial'
import { useFormatMoney, useFormatQuantity } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FeeConversionNotice } from './fee-conversion-notice'
import type { PortfolioActivityRow } from './portfolio-activity-view-model'
import { PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import type { HoldingViewModel } from './portfolios-view-model'

export type HoldingDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'access-transition' }
  | { status: 'loaded'; holding: HoldingViewModel; activity: readonly PortfolioActivityRow[]; refreshing: boolean }

export type HoldingDetailScreenProps = {
  state: HoldingDetailViewState
  onBack: () => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

export function HoldingDetailScreen({ state, onBack, onRefresh, onLogout }: HoldingDetailScreenProps) {
  const formatMoney = useFormatMoney()
  const formatQuantity = useFormatQuantity()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('holdingDetail.loading')} palette={palette} onBack={onBack} backLabel={t('holdingDetail.back')} />
  if (state.status === 'error' || state.status === 'not-found') {
    const key = state.status === 'not-found' ? 'notFound' : 'error'
    return <PortfolioFailure title={t(`holdingDetail.${key}.title`)} message={t(`holdingDetail.${key}.message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('holdingDetail.back')} onRetry={onRefresh} onSignOut={onLogout} onBack={onBack} canRetry={state.status === 'error'} palette={palette} />
  }

  const { holding, activity } = state
  const money = (value: number | null) => value === null ? t('holdingDetail.unavailable') : `${formatMoney(value, { locale, currency: holding.currency })}`
  const percent = (value: number | null) => value === null ? t('holdingDetail.unavailable') : formatPercentagePoints(value, locale, { maximumFractionDigits: 1 })

  const value = (text: string, available: boolean) => <StatValue tone={available ? 'default' : 'muted'}>{text}</StatValue>
  const gainText = holding.gain === null ? t('holdingDetail.unavailable') : `${holding.gain > 0 ? '+' : ''}${money(holding.gain)} · ${percent(holding.gainPercent)}`
  const cells = [
    { key: 'gain', label: t('holdingDetail.gainLoss'), text: gainText, available: holding.gain !== null },
    { key: 'weight', label: t('holdingDetail.portfolioWeight'), text: percent(holding.allocation), available: holding.allocation !== null },
    { key: 'quantity', label: t('holdingDetail.quantity'), text: formatQuantity(holding.quantity, { locale, maximumFractionDigits: 6 }), available: true },
    { key: 'price', label: t('holdingDetail.currentPrice'), text: money(holding.currentPrice), available: holding.currentPrice !== null },
    { key: 'average', label: t('holdingDetail.averageBuyPrice'), text: money(holding.averageBuyPrice), available: holding.averageBuyPrice !== null },
  ]

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/portfolio" onPress={onBack} label={t('holdingDetail.back')} />
            <ObjectHeader
              descriptor={`${holding.name} · ${holding.type}`}
              leading={<EntityMark {...assetMark(holding.symbol, holding.logoUrl)} />}
              title={holding.symbol}
              figure={(
                <View style={styles.figure}>
                  <HeadlineFigure
                    accessibilityLabel={`${t('holdingDetail.currentValue')}, ${money(holding.currentValue)}`}
                    currency={holding.currency}
                    label={t('holdingDetail.currentValue')}
                    labelTone="muted"
                    locale={locale}
                    size="md"
                    value={holding.currentValue}
                  />
                </View>
              )}
            />
          </View>

          {holding.isInvalid ? (
            <View style={[styles.notice, { borderColor: palette.destructiveText }]}>
              <UiText variant="meta">{t('holdingDetail.invalidHolding')}</UiText>
            </View>
          ) : null}

          <View>
            <StatList>
              {cells.map((cell) => (
                <View accessible accessibilityLabel={`${cell.label}, ${cell.text}`} key={cell.key}>
                  <Stat label={cell.label} locale={locale} valueNode={value(cell.text, cell.available)} />
                </View>
              ))}
            </StatList>
            {holding.feeConversionIncomplete ? <FeeConversionNotice scope="holding" palette={palette} /> : null}
          </View>

          <Section title={t('holdingDetail.activity')} variant="open">
            {activity.length === 0 ? (
              <UiText tone="muted" variant="meta">{t('holdingDetail.emptyActivity')}</UiText>
            ) : (
              <List divided>
                {activity.map((row) => <ActivityRow key={row.id} row={row} locale={locale} currency={holding.currency} />)}
              </List>
            )}
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ActivityRow({ row, locale, currency }: { row: PortfolioActivityRow; locale: string; currency: string }) {
  const formatMoney = useFormatMoney()
  const formatQuantity = useFormatQuantity()
  const { t } = useTranslation()
  const date = row.timestamp ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(row.timestamp)) : t('holdingDetail.unavailable')
  const amount = row.amount === null ? null : `${formatMoney(row.amount, { locale, currency: row.currency ?? currency })}`
  const label = row.itemType === 'STOCK_SPLIT'
    ? t('holdingDetail.stockSplit')
    : row.type
      ? t(`portfolioActivity.types.${row.type}`, { defaultValue: row.typeLabel ?? row.type })
      : t('holdingDetail.unavailable')
  const quantity = row.quantity === null ? null : t('portfolioActivity.quantityValue', { value: formatQuantity(row.quantity, { locale }) })
  return (
    <ListRow
      accessibilityLabel={`${label}, ${date}${amount ? `, ${amount}` : ''}`}
      density="comfortable"
      title={label}
      meta={[date]}
      figure={amount ? <UiText align="right" variant="amount">{amount}</UiText> : undefined}
      figureMeta={quantity ? <UiText align="right" tone="muted" variant="amountSmall">{quantity}</UiText> : undefined}
    />
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  // Space, not rules, between the figure, the position and the activity.
  page: { width: '100%', maxWidth: 800, alignSelf: 'center', gap: themeTokens.spacing[10] },
  header: { gap: themeTokens.spacing[4] },
  figure: { marginTop: themeTokens.spacing[4] },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})

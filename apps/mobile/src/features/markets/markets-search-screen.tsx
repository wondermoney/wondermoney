import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { IconButton } from '@/components/ui/icon-button'
import { List, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

import { MarketsFailure, marketsStyles } from './markets-screen-parts'
import type { SearchResultRow } from './markets-view-model'

export type MarketsSearchScreenState =
  | { status: 'access-transition' }
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'loaded'; rows: readonly SearchResultRow[] }

export type MarketsSearchScreenProps = {
  state: MarketsSearchScreenState
  query: string
  onQueryChange: (value: string) => void
  onSelectSymbol: (symbol: string) => void
  /** Kept for the failure screens' back link; the Explorer itself is a section tab with no back link. */
  onBack: () => void
  /** Watchlist is a section tab now; kept so the route's wiring stays intact. */
  onOpenWatchlist?: () => void
  onOpenScreener: () => void
}

/** Web's preview chart placeholder bars (`FinancialMarketsExplorerEmptyState`), heights in percent. */
const PREVIEW_BARS = [32, 56, 44, 68, 52, 76, 60, 84] as const

/**
 * Web's Explorer (`financial-markets/explorer`) before a ticker is picked: the
 * page title, "Explore an asset" with its description, the search field, and
 * the sample-asset preview card. Picking a result opens the asset screen,
 * where web shows the same sections inline.
 */
export function MarketsSearchScreen({ state, query, onQueryChange, onSelectSymbol, onBack, onOpenScreener }: MarketsSearchScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (state.status === 'access-transition') return null

  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <MarketsFailure
        title={t(invalid ? 'marketsSearch.invalidResponse.title' : 'marketsSearch.error.title')}
        message={t(invalid ? 'marketsSearch.invalidResponse.message' : 'marketsSearch.error.message')}
        backLabel={t('marketsSearch.back')}
        retryLabel={t('common.retry')}
        onBack={onBack}
        onRetry={onBack}
        palette={palette}
        retryable={false}
      />
    )
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={marketsStyles.content} keyboardShouldPersistTaps="handled">
        <View style={marketsStyles.page}>
          <PageHeader
            action={<IconButton accessibilityLabel={t('common.moreActions')} icon="more-vertical" onPress={() => setMenuOpen(true)} testID="markets-more" />}
            title={t('navigation.explorer')}
          />

          <View style={styles.explore}>
            <View style={styles.exploreCopy}>
              <Text accessibilityRole="header" variant="heading">{t('marketsSearch.exploreTitle')}</Text>
              <Text tone="muted" variant="meta">{t('marketsSearch.exploreDescription')}</Text>
            </View>
            <TextInput
              accessibilityLabel={t('marketsSearch.searchLabel')}
              allowFontScaling
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={() => setFocused(false)}
              onChangeText={onQueryChange}
              onFocus={() => setFocused(true)}
              placeholder={t('marketsSearch.placeholder')}
              placeholderTextColor={palette.mutedForeground}
              style={[
                styles.search,
                { color: palette.foreground, borderColor: focused ? palette.ring : palette.input, borderWidth: focused ? 2 : 1 },
              ]}
              value={query}
            />
          </View>

          {state.status === 'idle' ? <ExplorerPreview /> : null}

          {state.status === 'loading' ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={t('marketsSearch.loading')} style={styles.loading}>
              {[0, 1, 2].map((key) => (
                <View key={key} style={[styles.skeleton, { backgroundColor: palette.muted }]} />
              ))}
            </View>
          ) : null}

          {state.status === 'empty' ? (
            <View style={styles.emptyGroup}>
              <Text variant="bodyStrong">{t('marketsSearch.emptyTitle')}</Text>
              <Text tone="muted" variant="meta">{t('marketsSearch.empty', { term: query })}</Text>
            </View>
          ) : null}

          {state.status === 'loaded' ? (
            <List divided>
              {state.rows.map((row, index) => (
                <ListRow
                  accessibilityLabel={[row.name, row.symbol, row.exchange].filter(Boolean).join(', ')}
                  density="comfortable"
                  key={`${row.symbol}-${index}`}
                  // Search results come from the market-data provider, which sends no logo: the ticker's letters.
                  leading={<EntityMark {...assetMark(row.symbol, null)} />}
                  meta={[[row.name, row.exchange].filter(Boolean).join(' · ') || null]}
                  onPress={() => onSelectSymbol(row.symbol)}
                  title={row.symbol}
                />
              ))}
            </List>
          ) : null}

        </View>
      </ScrollView>
      {/* Mobile-only: web reaches the screener from elsewhere. It sits behind the title row's
          overflow so it never competes with the search. */}
      <OptionSheet
        mode="menu"
        onClose={() => setMenuOpen(false)}
        onSelect={(value) => { if (value === 'screener') onOpenScreener() }}
        options={[{ value: 'screener', label: t('marketsSearch.screenerLink') }]}
        title={t('common.moreActions')}
        visible={menuOpen}
      />
    </SafeAreaView>
  )
}

/** Web's `FinancialMarketsExplorerEmptyState` preview card, sample placeholders only. */
function ExplorerPreview() {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <Card density="standalone" style={styles.preview} testID="explorer-preview">
      <View style={styles.previewHead}>
        <View style={styles.previewBadge}>
          <Badge label={t('common.preview')} tone="outline" />
        </View>
        <View style={[styles.previewIdentity, { borderBottomColor: palette.border }]}>
          <View style={styles.previewCompany}>
            <Text tone="muted" variant="label">{t('marketsSearch.previewCompany')}</Text>
            <View style={styles.previewCodes}>
              <Text tone="muted" variant="amount">---</Text>
              <Text tone="muted" variant="amount">---</Text>
            </View>
            <Text tone="muted" variant="meta">{t('marketsSearch.previewName')}</Text>
            <Text tone="muted" variant="amountSmall">---</Text>
          </View>
          <View style={styles.previewPrice}>
            <Text align="right" style={styles.previewPriceValue} tone="muted" variant="amount">$--</Text>
            <Text align="right" tone="muted" variant="amount">---</Text>
          </View>
        </View>
      </View>

      <View style={styles.previewChartGroup}>
        <Text variant="metaStrong">{t('marketsSearch.previewChart')}</Text>
        {/* Background step, not a second border: the card already has one (No-Nesting rule). */}
        <View importantForAccessibility="no-hide-descendants" style={[styles.previewChart, { backgroundColor: palette.muted }]}>
          {PREVIEW_BARS.map((height, index) => (
            <View key={index} style={[styles.previewBar, { height: `${height}%`, backgroundColor: palette.border }]} />
          ))}
        </View>
      </View>

      <View style={[styles.previewMetrics, { backgroundColor: palette.muted }]}>
        {([
          ['marketsSearch.previewFundamentals', '--'],
          ['marketsSearch.previewFinancials', '$--'],
          ['marketsSearch.previewEarnings', '--'],
        ] as const).map(([key, placeholder], index) => (
          <View key={key} style={[styles.previewMetric, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}>
            <Text tone="muted" variant="label">{t(key)}</Text>
            <Text style={styles.previewMetricValue} tone="muted" variant="amount">{placeholder}</Text>
          </View>
        ))}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  explore: { gap: themeTokens.spacing[4] },
  exploreCopy: { gap: themeTokens.spacing[2] },
  search: {
    ...textStyles.meta,
    minHeight: themeTokens.size.control,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
    backgroundColor: 'transparent',
  },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { width: '100%', height: 44, borderRadius: themeTokens.radius.md },
  emptyGroup: { gap: themeTokens.spacing[2] },
  preview: { gap: themeTokens.spacing[6] },
  previewHead: { gap: themeTokens.spacing[4] },
  previewBadge: { alignItems: 'flex-start' },
  previewIdentity: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: themeTokens.spacing[4], borderBottomWidth: 1, paddingBottom: themeTokens.spacing[4] },
  previewCompany: { gap: themeTokens.spacing[1] },
  previewCodes: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  previewPrice: { alignItems: 'flex-end', gap: themeTokens.spacing[1] },
  previewPriceValue: { ...textStyles.section, fontFamily: textStyles.amount.fontFamily },
  previewChartGroup: { gap: themeTokens.spacing[2] },
  previewChart: { height: 128, flexDirection: 'row', alignItems: 'flex-end', gap: themeTokens.spacing[2], borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] },
  previewBar: { flex: 1, borderRadius: themeTokens.radius.sm },
  previewMetrics: { borderRadius: themeTokens.radius.lg },
  previewMetric: { padding: themeTokens.spacing[4], gap: themeTokens.spacing[1] },
  previewMetricValue: { fontWeight: '600' },
})

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { RecentTransactionRow } from './recent-transactions-view-model'

export type RecentTransactionsSectionState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'loaded'; rows: readonly RecentTransactionRow[]; stale: boolean }


export function RecentTransactionsSection({ state, onRetry }: {
  state: RecentTransactionsSectionState
  onRetry: () => void | Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.heading, { color: palette.foreground }]}>
        {t('recentTransactions.heading')}
      </Text>

      {state.status === 'loading' ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t('recentTransactions.loading')} style={styles.loading}>
          {[220, 180].map((width, index) => (
            <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />
          ))}
        </View>
      ) : null}

      {state.status === 'error' || state.status === 'invalid-response' ? (
        <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}>
          <Text accessibilityRole="alert" allowFontScaling style={[styles.noticeText, { color: palette.foreground }]}>
            {t(state.status === 'invalid-response' ? 'recentTransactions.invalidResponse' : 'recentTransactions.error')}
          </Text>
          <Retry label={t('common.retry')} onPress={onRetry} palette={palette} />
        </View>
      ) : null}

      {state.status === 'loaded' ? (
        <>
          {state.stale ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.stale, { color: palette.mutedForeground }]}>
              {t('recentTransactions.stale')}
            </Text>
          ) : null}
          {state.rows.length === 0 ? (
            <Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground }]}>{t('recentTransactions.empty')}</Text>
          ) : (
            <View style={[styles.list, { borderColor: palette.border }]}>
              {state.rows.map((row, index) => (
                <Row key={index} row={row} locale={locale} separated={index > 0} palette={palette} />
              ))}
            </View>
          )}
        </>
      ) : null}
    </View>
  )
}

function Row({ row, locale, separated, palette }: {
  row: RecentTransactionRow
  locale: string
  separated: boolean
  palette: Palette
}) {
  const { t } = useTranslation()
  const dateText = row.occurredAt ? formatDate(row.occurredAt, locale) : t('recentTransactions.unavailableDate')
  const amountText = row.amount === null || row.currencyCode === null
    ? t('recentTransactions.unavailableAmount')
    : formatCurrency(row.amount, { locale, currency: row.currencyCode })

  const title = row.kind === 'synthetic-initial-balance'
    ? t('recentTransactions.initialBalance')
    : row.displayName ?? t('recentTransactions.unavailableName')
  const directionText = row.kind === 'persisted' && row.direction
    ? t(`recentTransactions.${row.direction}`)
    : null

  const label = [title, dateText, amountText, directionText].filter(Boolean).join(', ')

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}
    >
      <View style={styles.rowMain}>
        <Text allowFontScaling style={[styles.rowTitle, { color: palette.foreground }]}>{title}</Text>
        <Text allowFontScaling style={[styles.rowDate, { color: palette.mutedForeground }]}>{dateText}</Text>
      </View>
      <View style={styles.rowAmountGroup}>
        <Text allowFontScaling style={[styles.rowAmount, { color: palette.foreground }]}>{amountText}</Text>
        {directionText ? (
          <Text allowFontScaling style={[styles.rowDirection, { color: palette.mutedForeground }]}>{directionText}</Text>
        ) : null}
      </View>
    </View>
  )
}

function Retry({ label, onPress, palette }: { label: string; onPress: () => void | Promise<void>; palette: Palette }) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [styles.retry, { borderColor: palette.primary }, focused && { borderWidth: 2, borderColor: palette.foreground }, pressed && styles.pressed]}
    >
      <Text allowFontScaling style={[styles.retryLabel, { color: palette.primary }]}>{label}</Text>
    </Pressable>
  )
}

function formatDate(iso: string, locale: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime())
    ? iso
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parsed)
}

const styles = StyleSheet.create({
  section: { width: '100%', gap: themeTokens.spacing[3] },
  heading: { ...textStyles.section },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { maxWidth: '100%', height: themeTokens.spacing[5], borderRadius: themeTokens.radius.sm },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  noticeText: { ...textStyles.body },
  stale: { ...textStyles.meta },
  empty: { ...textStyles.body },
  list: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  row: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[4],
    padding: themeTokens.spacing[4],
  },
  rowMain: { flex: 1, gap: themeTokens.spacing[1] },
  rowTitle: { ...textStyles.bodyStrong },
  rowDate: { ...textStyles.meta },
  rowAmountGroup: { alignItems: 'flex-end', gap: themeTokens.spacing[1] },
  rowAmount: { ...textStyles.amount },
  rowDirection: { ...textStyles.label },
  retry: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', paddingHorizontal: themeTokens.spacing[4], borderWidth: 1, borderRadius: themeTokens.radius.md },
  retryLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
})
